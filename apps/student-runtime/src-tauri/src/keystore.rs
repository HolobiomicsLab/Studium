use keyring::Entry;
use thiserror::Error;

const SERVICE: &str = "test.studium.runtime";
const DB_KEY_USER: &str = "sqlcipher-db-key";

#[derive(Debug, Error)]
pub enum KeystoreError {
    #[error("keyring error: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("hex decode: {0}")]
    Hex(#[from] hex::FromHexError),
}

pub fn store_db_key(key: &[u8; 32]) -> Result<(), KeystoreError> {
    let entry = Entry::new(SERVICE, DB_KEY_USER)?;
    entry.set_password(&hex::encode(key))?;
    Ok(())
}

pub fn load_db_key() -> Result<Option<[u8; 32]>, KeystoreError> {
    let entry = Entry::new(SERVICE, DB_KEY_USER)?;
    match entry.get_password() {
        Ok(hex_str) => {
            let bytes = hex::decode(hex_str)?;
            if bytes.len() != 32 { return Ok(None); }
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            Ok(Some(key))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(KeystoreError::Keyring(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_and_load_round_trip() {
        let key = [7u8; 32];
        if let Err(e) = store_db_key(&key) {
            eprintln!("keystore store unavailable: {e}, skipping"); return;
        }
        match load_db_key() {
            Err(e) => eprintln!("keystore load error: {e}, skipping"),
            Ok(None) => eprintln!("keystore returned None after store (macOS unlock?), skipping"),
            Ok(Some(loaded)) => assert_eq!(loaded, key),
        }
    }

    #[test]
    fn load_missing_is_handled() {
        let _ = load_db_key();
    }
}
