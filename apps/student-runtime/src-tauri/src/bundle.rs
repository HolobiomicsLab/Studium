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
}
