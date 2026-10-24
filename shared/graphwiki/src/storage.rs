use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};

use crate::Result;

pub fn path(root: &Path, relative: impl AsRef<Path>) -> Result<PathBuf> {
    let relative = relative.as_ref();
    let mut result = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err(format!(
                "Expected a path within the graph: {}",
                relative.display()
            ));
        };
        result.push(name);
        reject_symlink(&result)?;
    }
    Ok(result)
}

fn reject_symlink(path: &Path) -> Result<()> {
    if metadata(path)?.is_some_and(|metadata| metadata.file_type().is_symlink()) {
        return Err(format!("Symlinks are not supported: {}", path.display()));
    }
    Ok(())
}

fn metadata(path: &Path) -> Result<Option<fs::Metadata>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("{}: {error}", path.display())),
    }
}

pub fn read(path: &Path) -> Result<String> {
    fs::read_to_string(path).map_err(|error| format!("{}: {error}", path.display()))
}

pub fn optional(path: &Path) -> Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("{}: {error}", path.display())),
    }
}

pub fn replace(path: &Path, content: &str) -> Result<()> {
    reject_symlink(path)?;
    if optional(path)?.as_deref() == Some(content) {
        return Ok(());
    }
    write_atomic(path, content)
}

fn write_atomic(path: &Path, content: &str) -> Result<()> {
    let parent = path.parent().ok_or("Destination has no parent")?;
    let temp = prepare_temp(parent, content)?;
    temp.persist(path)
        .map_err(|error| format!("{}: {error}", path.display()))?;
    sync_directory(parent)
}

fn prepare_temp(parent: &Path, content: &str) -> Result<tempfile::NamedTempFile> {
    let mut temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("{}: {error}", parent.display()))?;
    fill_temp(&mut temp, content)?;
    Ok(temp)
}

fn fill_temp(temp: &mut tempfile::NamedTempFile, content: &str) -> Result<()> {
    temp.write_all(content.as_bytes())
        .map_err(|error| error.to_string())?;
    temp.as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn sync_directory(path: &Path) -> Result<()> {
    #[cfg(unix)]
    fs::File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("{}: {error}", path.display()))?;
    Ok(())
}

pub fn markdown_files(directory: &Path) -> Result<Vec<PathBuf>> {
    let entries =
        fs::read_dir(directory).map_err(|error| format!("{}: {error}", directory.display()))?;
    let paths = entries
        .map(|entry| {
            entry
                .map(|entry| entry.path())
                .map_err(|error| error.to_string())
        })
        .collect::<Result<Vec<_>>>()?;
    let mut files = paths
        .into_iter()
        .filter(|path| path.extension().is_some_and(|ext| ext == "md"))
        .map(checked_markdown)
        .collect::<Result<Vec<_>>>()?;
    files.sort();
    Ok(files)
}

fn checked_markdown(path: PathBuf) -> Result<PathBuf> {
    reject_symlink(&path)?;
    if !path.is_file() {
        return Err(format!("Expected a Markdown file: {}", path.display()));
    }
    Ok(path)
}

pub fn identifier(name: &str) -> bool {
    !name.is_empty()
        && name.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}
