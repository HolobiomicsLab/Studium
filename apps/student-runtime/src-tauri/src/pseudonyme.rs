use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::Sha256;

pub fn generate_secret() -> [u8; 32] {
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    buf
}

pub fn compute_pseudonyme(secret: &[u8; 32], lesson_id: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret)
        .expect("HMAC accepts any key length");
    mac.update(lesson_id.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pseudonyme_is_stable_for_same_secret_and_lesson() {
        let secret = [42u8; 32];
        let p1 = compute_pseudonyme(&secret, "lesson-001");
        let p2 = compute_pseudonyme(&secret, "lesson-001");
        assert_eq!(p1, p2);
        assert_eq!(p1.len(), 64);
    }

    #[test]
    fn pseudonyme_differs_for_different_lesson_ids() {
        let secret = [42u8; 32];
        let p1 = compute_pseudonyme(&secret, "lesson-001");
        let p2 = compute_pseudonyme(&secret, "lesson-002");
        assert_ne!(p1, p2);
    }

    #[test]
    fn pseudonyme_differs_after_secret_reset() {
        let secret1 = [42u8; 32];
        let secret2 = [99u8; 32];
        let p1 = compute_pseudonyme(&secret1, "lesson-001");
        let p2 = compute_pseudonyme(&secret2, "lesson-001");
        assert_ne!(p1, p2);
    }

    #[test]
    fn generate_secret_is_random() {
        let s1 = generate_secret();
        let s2 = generate_secret();
        assert_ne!(s1, s2);
    }
}
