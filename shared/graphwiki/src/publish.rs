use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::{NaiveDate, SecondsFormat, Utc};
use sha2::{Digest, Sha256};

use crate::{graph::Graph, page::Page, storage, Result};

struct Batch {
    name: String,
    summary: String,
    graph: Graph,
    fingerprint: String,
}

impl Batch {
    fn read(root: &Path, name: &str) -> Result<Self> {
        if !storage::identifier(name) {
            return Err("CHANGE must be a lowercase hyphenated identifier".into());
        }
        let graph = read_draft(root, name)?;
        let summary = read_summary(root, name)?;
        let fingerprint = fingerprint(&summary, &graph);
        Ok(Self {
            name: name.into(),
            summary,
            graph,
            fingerprint,
        })
    }

    fn entry(&self, timestamp: &str) -> String {
        let summary = self
            .summary
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let pages = self
            .graph
            .pages
            .values()
            .map(|page| format!("[[{}]]", page.title()))
            .collect::<Vec<_>>()
            .join(", ");
        format!("- {timestamp} | publish | {}\n  change:: {}\n  batch:: {}\n  - {summary}\n  - Pages: {pages}\n",
            self.name, self.name, self.fingerprint)
    }
}

fn read_draft(root: &Path, name: &str) -> Result<Graph> {
    let mut graph = Graph::default();
    for section in ["pages", "journals"] {
        graph
            .pages
            .extend(read_draft_directory(root, name, section)?.pages);
    }
    validate_draft(&graph)?;
    Ok(graph)
}

fn read_draft_directory(root: &Path, name: &str, section: &'static str) -> Result<Graph> {
    let directory = storage::path(root, format!(".drafts/{name}/{section}"))?;
    if !directory.try_exists().map_err(|error| error.to_string())? {
        return Ok(Graph::default());
    }
    check_draft_entries(&directory)?;
    Graph::from_directory(&directory, section)
}

fn check_draft_entries(directory: &Path) -> Result<()> {
    let entries =
        fs::read_dir(directory).map_err(|error| format!("{}: {error}", directory.display()))?;
    for entry in entries {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.extension().is_none_or(|ext| ext != "md") {
            return Err(format!(
                "Draft pages must be flat Markdown files: {}",
                path.display()
            ));
        }
    }
    Ok(())
}

fn validate_draft(graph: &Graph) -> Result<()> {
    if graph.pages.is_empty() {
        return Err("The draft batch contains no Markdown pages".into());
    }
    for page in graph.pages.values() {
        validate_draft_page(page)?;
    }
    Ok(())
}

fn validate_draft_page(page: &Page) -> Result<()> {
    if !storage::identifier(&page.name) || page.system() {
        return Err(format!(
            "Draft {} must have a lowercase hyphenated name other than index or log",
            page.name
        ));
    }
    if page.journal() {
        validate_journal_name(&page.name)?;
    }
    Ok(())
}

fn validate_journal_name(name: &str) -> Result<()> {
    let valid = NaiveDate::parse_from_str(name, "%Y-%m-%d")
        .is_ok_and(|date| date.format("%Y-%m-%d").to_string() == name);
    if !valid {
        return Err(format!(
            "Journal {name} must use a valid YYYY-MM-DD filename"
        ));
    }
    Ok(())
}

fn read_summary(root: &Path, name: &str) -> Result<String> {
    let path = storage::path(root, format!(".drafts/{name}/summary.txt"))?;
    let summary = storage::read(&path)?;
    if summary.trim().is_empty() {
        return Err("summary.txt must describe the change".into());
    }
    Ok(summary)
}

fn fingerprint(summary: &str, graph: &Graph) -> String {
    let mut hash = Sha256::new();
    hash_text(&mut hash, summary);
    for page in graph.pages.values() {
        let name = if page.journal() {
            page.path()
        } else {
            page.name.clone()
        };
        hash_text(&mut hash, &name);
        hash_text(&mut hash, &page.content);
    }
    format!("{:x}", hash.finalize())
}

fn hash_text(hash: &mut Sha256, text: &str) {
    hash.update((text.len() as u64).to_le_bytes());
    hash.update(text.as_bytes());
}

struct Pending {
    change: String,
    fingerprint: String,
    timestamp: String,
}

impl Pending {
    fn read(root: &Path) -> Result<Option<Self>> {
        let path = storage::path(root, ".graphwiki/pending")?;
        storage::optional(&path)?
            .map(|text| Self::parse(&text))
            .transpose()
    }

    fn parse(text: &str) -> Result<Self> {
        let lines: Vec<&str> = text.lines().collect();
        let [change, fingerprint, timestamp] = lines.as_slice() else {
            return Err("Invalid .graphwiki/pending receipt; restore it before publishing".into());
        };
        Ok(Self {
            change: (*change).into(),
            fingerprint: (*fingerprint).into(),
            timestamp: (*timestamp).into(),
        })
    }

    fn check(&self, batch: &Batch) -> Result<()> {
        if self.change != batch.name || self.fingerprint != batch.fingerprint {
            return Err(format!(
                "Unfinished publication {}; retry its original, unmodified draft first",
                self.change
            ));
        }
        Ok(())
    }

    fn encode(&self) -> String {
        format!(
            "{}\n{}\n{}\n",
            self.change, self.fingerprint, self.timestamp
        )
    }
}

pub fn require_complete(root: &Path) -> Result<()> {
    if let Some(pending) = Pending::read(root)? {
        return Err(format!(
            "Unfinished publication {}; run make publish CHANGE={}",
            pending.change, pending.change
        ));
    }
    Ok(())
}

fn pending_for(root: &Path, batch: &Batch) -> Result<Option<Pending>> {
    let pending = Pending::read(root)?;
    if let Some(pending) = &pending {
        pending.check(batch)?;
    }
    Ok(pending)
}

pub fn publish(root: &Path, name: &str) -> Result<String> {
    publish_with(root, name, storage::replace)
}

fn publish_with(
    root: &Path,
    name: &str,
    mut write: impl FnMut(&Path, &str) -> Result<()>,
) -> Result<String> {
    let batch = Batch::read(root, name)?;
    publish_batch(root, batch, &mut write)
}

fn publish_batch(
    root: &Path,
    batch: Batch,
    write: &mut impl FnMut(&Path, &str) -> Result<()>,
) -> Result<String> {
    let pending = pending_for(root, &batch)?;
    if completed(root, &batch)? {
        return replay(root, &batch.name);
    }
    let publication = Publication::prepare(root, batch, pending)?;
    publication.apply(root, write)
}

struct Publication {
    batch: Batch,
    pending: Pending,
    writes: Vec<(PathBuf, String)>,
    warnings: Vec<String>,
}

impl Publication {
    fn prepare(root: &Path, batch: Batch, pending: Option<Pending>) -> Result<Self> {
        let graph = proposed_graph(root, &batch)?;
        let warnings = graph.validate()?;
        let pending = pending.unwrap_or_else(|| Pending {
            change: batch.name.clone(),
            fingerprint: batch.fingerprint.clone(),
            timestamp: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        });
        let writes = planned_writes(root, &batch, &graph, &pending.timestamp)?;
        Ok(Self {
            batch,
            pending,
            writes,
            warnings,
        })
    }

    fn apply(
        &self,
        root: &Path,
        write: &mut impl FnMut(&Path, &str) -> Result<()>,
    ) -> Result<String> {
        self.begin(root, write)?;
        let changed = apply_writes(root, &self.writes, write)?;
        self.finish(root, write)?;
        Ok(format!(
            "{}Published {}.\n{}\n",
            self.warnings.join(""),
            self.batch.name,
            changed.join("\n")
        ))
    }

    fn begin(&self, root: &Path, write: &mut impl FnMut(&Path, &str) -> Result<()>) -> Result<()> {
        prepare_directories(root, &self.batch)?;
        let path = storage::path(root, ".graphwiki/pending")?;
        write(&path, &self.pending.encode())
    }

    fn finish(&self, root: &Path, write: &mut impl FnMut(&Path, &str) -> Result<()>) -> Result<()> {
        let path = receipt_path(root, &self.batch.name)?;
        write(&path, &self.batch.fingerprint)?;
        clear_pending(root)
    }
}

fn prepare_directories(root: &Path, batch: &Batch) -> Result<()> {
    create_directory(root, ".graphwiki/receipts")?;
    for page in batch.graph.pages.values() {
        create_directory(root, page.directory)?;
    }
    storage::sync_directory(root)
}

fn create_directory(root: &Path, relative: &str) -> Result<()> {
    fs::create_dir_all(storage::path(root, relative)?).map_err(|error| error.to_string())
}

fn proposed_graph(root: &Path, batch: &Batch) -> Result<Graph> {
    let mut graph = Graph::load(root)?;
    graph.pages.extend(batch.graph.pages.clone());
    Ok(graph)
}

fn apply_writes(
    root: &Path,
    writes: &[(PathBuf, String)],
    write: &mut impl FnMut(&Path, &str) -> Result<()>,
) -> Result<Vec<String>> {
    let mut changed = Vec::new();
    for (path, content) in writes {
        if storage::optional(path)?.as_deref() != Some(content) {
            write(path, content)?;
            changed.push(
                path.strip_prefix(root)
                    .unwrap_or(path)
                    .display()
                    .to_string(),
            );
        }
    }
    Ok(changed)
}

fn receipt_path(root: &Path, name: &str) -> Result<PathBuf> {
    storage::path(root, format!(".graphwiki/receipts/{name}"))
}

fn completed(root: &Path, batch: &Batch) -> Result<bool> {
    let Some(recorded) = storage::optional(&receipt_path(root, &batch.name)?)? else {
        return Ok(false);
    };
    if recorded != batch.fingerprint {
        return Err(format!(
            "Change {} was already published with different contents; use a new CHANGE",
            batch.name
        ));
    }
    Ok(true)
}

fn replay(root: &Path, name: &str) -> Result<String> {
    clear_pending(root)?;
    Ok(format!("Change {name} is already published.\n"))
}

fn clear_pending(root: &Path) -> Result<()> {
    let path = storage::path(root, ".graphwiki/pending")?;
    remove_pending(&path, root)
}

fn remove_pending(path: &Path, root: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => storage::sync_directory(&root.join(".graphwiki")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("{}: {error}", path.display())),
    }
}

fn planned_writes(
    root: &Path,
    batch: &Batch,
    graph: &Graph,
    timestamp: &str,
) -> Result<Vec<(PathBuf, String)>> {
    let mut writes = page_writes(root, batch)?;
    writes.push((storage::path(root, "pages/index.md")?, graph.index()));
    writes.push(log_write(root, batch, timestamp)?);
    preflight_writes(root, batch, &writes)?;
    Ok(writes)
}

fn page_writes(root: &Path, batch: &Batch) -> Result<Vec<(PathBuf, String)>> {
    batch
        .graph
        .pages
        .values()
        .map(|page| {
            let path = storage::path(root, page.path())?;
            Ok((path, page.content.clone()))
        })
        .collect()
}

fn preflight_writes(root: &Path, batch: &Batch, writes: &[(PathBuf, String)]) -> Result<()> {
    for (path, _) in writes {
        storage::optional(path)?;
    }
    receipt_path(root, &batch.name)?;
    Ok(())
}

fn log_write(root: &Path, batch: &Batch, timestamp: &str) -> Result<(PathBuf, String)> {
    let path = storage::path(root, "pages/log.md")?;
    let log = storage::optional(&path)?.unwrap_or_else(|| {
        "type:: system\ndescription:: Chronological record of published changes.\n".into()
    });
    Ok((path, append_log(log, batch, timestamp)?))
}

fn append_log(mut log: String, batch: &Batch, timestamp: &str) -> Result<String> {
    let marker = format!("  change:: {}", batch.name);
    let lines: Vec<&str> = log.lines().collect();
    if let Some(position) = lines.iter().position(|line| *line == marker) {
        let expected = format!("  batch:: {}", batch.fingerprint);
        if lines.get(position + 1) != Some(&expected.as_str()) {
            return Err(format!(
                "Log already contains a conflicting change {}",
                batch.name
            ));
        }
    } else {
        if !log.ends_with('\n') {
            log.push('\n');
        }
        log.push_str(&batch.entry(timestamp));
    }
    Ok(log)
}

#[cfg(test)]
mod tests;
