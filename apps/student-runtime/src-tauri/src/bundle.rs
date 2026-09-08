use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Read;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum BundleError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("zip: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("lesson.json missing in bundle")]
    LessonMissing,
}

pub fn read_lesson_json(zip_path: &PathBuf) -> Result<String, BundleError> {
    let file = File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    let mut entry = archive.by_name("lesson.json").map_err(|e| match e {
        zip::result::ZipError::FileNotFound => BundleError::LessonMissing,
        other => BundleError::Zip(other),
    })?;
    let mut json = String::new();
    entry.read_to_string(&mut json)?;
    Ok(json)
}

/// One entry of the library, as the screen needs to render it (INT-STUDIUM-034).
///
/// `path` is what `load_bundle` is later handed, so it is the absolute path this listing
/// actually read — the player must not have to reconstruct it from a name.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleEntry {
    pub path: String,
    pub bundle_id: String,
    pub title: String,
    pub n_scenes: usize,
}

/// Every readable `.zip` bundle in `dir`, described by its own `lesson.json`.
///
/// The library screen used to state a title, a level and a scene count as literal markup, for
/// a bundle it never opened; those claims could not be wrong because nothing checked them, and
/// could not be right either. Here every field comes from the file.
///
/// Fail-soft is deliberate and bounded: a directory that does not exist is an EMPTY library
/// (a learner who has installed no lesson yet must see a library, not a crash), and an
/// unreadable zip is skipped rather than allowed to empty the whole list. It is bounded
/// because a *readable* bundle is never silently dropped — only the ones this function cannot
/// open at all.
pub fn list_bundles(dir: &PathBuf) -> Result<Vec<BundleEntry>, BundleError> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(BundleError::Io(e)),
    };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("zip") {
            continue;
        }
        let Ok(json) = read_lesson_json(&path) else { continue };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&json) else { continue };
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("bundle.zip")
            .to_string();
        found.push(BundleEntry {
            path: path.to_string_lossy().into_owned(),
            bundle_id: value["bundle_id"].as_str().unwrap_or(&file_name).to_string(),
            title: value["metadata"]["title"].as_str().unwrap_or(&file_name).to_string(),
            n_scenes: value["scenes"].as_array().map(|s| s.len()).unwrap_or(0),
        });
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make_test_zip(with_lesson: bool) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "studium-bundle-test-{}-{}.zip",
            std::process::id(),
            if with_lesson { "with" } else { "without" }
        ));
        let file = File::create(&path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default();
        if with_lesson {
            zip.start_file("lesson.json", opts).unwrap();
            zip.write_all(b"{\"bundle_id\":\"test\"}").unwrap();
        } else {
            zip.start_file("other.json", opts).unwrap();
            zip.write_all(b"{}").unwrap();
        }
        zip.finish().unwrap();
        path
    }

    #[test]
    fn reads_lesson_json_from_valid_zip() {
        let path = make_test_zip(true);
        let json = read_lesson_json(&path).expect("should read");
        assert!(json.contains("bundle_id"));
    }

    #[test]
    fn errors_on_missing_lesson_json() {
        let path = make_test_zip(false);
        let err = read_lesson_json(&path).unwrap_err();
        assert!(matches!(err, BundleError::LessonMissing));
    }

    #[test]
    fn errors_on_missing_file() {
        let path = PathBuf::from("/nonexistent/path.zip");
        let err = read_lesson_json(&path).unwrap_err();
        assert!(matches!(err, BundleError::Io(_)));
    }

    // -----------------------------------------------------------------------
    // list_bundles — INT-STUDIUM-034
    //
    // The library screen could open exactly one bundle, fixed at build time by a module
    // constant, so the atomistique bundle the M6 demo builds and validates two steps earlier
    // had no path through the user interface. A library needs to know what is in it.
    // -----------------------------------------------------------------------

    fn write_bundle(dir: &PathBuf, name: &str, lesson_json: &str) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let path = dir.join(name);
        let file = File::create(&path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("lesson.json", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(lesson_json.as_bytes()).unwrap();
        zip.finish().unwrap();
        path
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "studium-list-bundles-{}-{}",
            std::process::id(),
            name
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn lists_every_bundle_in_a_directory_with_its_own_title() {
        let dir = scratch("titles");
        write_bundle(
            &dir,
            "a.zip",
            r#"{"bundle_id":"atomistique-l1","metadata":{"title":"Atomistique L1"},
                "scenes":[{"id":"s1"},{"id":"s2"}]}"#,
        );
        write_bundle(
            &dir,
            "b.zip",
            r#"{"bundle_id":"metabo-001","metadata":{"title":"Métabolomique"},"scenes":[]}"#,
        );

        let mut found = list_bundles(&dir).expect("should list");
        found.sort_by(|a, b| a.bundle_id.cmp(&b.bundle_id));
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].bundle_id, "atomistique-l1");
        assert_eq!(found[0].title, "Atomistique L1");
        assert_eq!(found[0].n_scenes, 2);
        assert_eq!(found[1].bundle_id, "metabo-001");
        assert_eq!(found[1].n_scenes, 0);
        // the path is what the player is later handed, so it must be usable as given
        assert!(read_lesson_json(&PathBuf::from(&found[0].path)).is_ok());
    }

    #[test]
    fn a_missing_directory_is_an_empty_library_not_an_error() {
        // A learner who has installed no lesson yet must see a library, not a crash.
        let dir = scratch("missing").join("never-created");
        assert_eq!(list_bundles(&dir).unwrap().len(), 0);
    }

    #[test]
    fn one_unreadable_bundle_does_not_hide_the_readable_ones() {
        // Fail-soft, deliberately: a corrupt zip in the directory would otherwise empty the
        // whole library and the learner would have no way to tell which file caused it.
        let dir = scratch("mixed");
        write_bundle(
            &dir,
            "good.zip",
            r#"{"bundle_id":"good","metadata":{"title":"Good"},"scenes":[{"id":"s1"}]}"#,
        );
        std::fs::write(dir.join("broken.zip"), b"not a zip at all").unwrap();
        std::fs::write(dir.join("notes.txt"), b"ignored").unwrap();

        let found = list_bundles(&dir).expect("should list");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].bundle_id, "good");
    }

    #[test]
    fn a_bundle_without_a_title_falls_back_to_its_file_name() {
        // Never an empty row: a nameless entry is unclickable in practice.
        let dir = scratch("untitled");
        write_bundle(&dir, "mystery.zip", r#"{"scenes":[]}"#);
        let found = list_bundles(&dir).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].title, "mystery.zip");
        assert_eq!(found[0].bundle_id, "mystery.zip");
    }
}
