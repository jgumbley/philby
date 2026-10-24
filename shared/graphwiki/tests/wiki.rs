use std::{fs, path::Path, process::Command};

use graphwiki::execute;

const SOURCE: &str = "type:: source\ndescription:: Original evidence.\noriginal:: [Original](../assets/sources/original.txt)\ncustom-field:: preserved\n\n- Evidence summary.\n  id:: 550e8400-e29b-41d4-a716-446655440000\n";
const TOPIC: &str = "type:: topic\ndescription:: A test topic.\nsources:: [[source]]\n\n- Needle [x] supported by [[source]].\n";

fn fixture() -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    for directory in ["pages", "journals", "assets/sources"] {
        fs::create_dir_all(root.path().join(directory)).unwrap();
    }
    fs::write(
        root.path().join("assets/sources/original.txt"),
        "Original evidence bytes",
    )
    .unwrap();
    fs::write(
        root.path().join("pages/index.md"),
        "type:: system\n\n- Empty index\n",
    )
    .unwrap();
    fs::write(
        root.path().join("pages/log.md"),
        "type:: system\n\n- Earlier history\n",
    )
    .unwrap();
    draft(root.path(), "first", TOPIC);
    root
}

fn draft(root: &Path, change: &str, topic: &str) {
    batch(root, change, &[("source", SOURCE), ("topic", topic)]);
}

fn batch(root: &Path, change: &str, pages: &[(&str, &str)]) {
    let path = root.join(format!(".drafts/{change}"));
    fs::create_dir_all(path.join("pages")).unwrap();
    fs::write(path.join("summary.txt"), "Publish research notes.").unwrap();
    for (name, content) in pages {
        fs::write(path.join(format!("pages/{name}.md")), content).unwrap();
    }
}

fn empty_graph() -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("pages")).unwrap();
    root
}

fn read(root: &Path, relative: &str) -> String {
    fs::read_to_string(root.join(relative)).unwrap()
}

#[test]
fn empty_graph_index_does_not_create_publication_history() {
    let root = empty_graph();
    execute("index", root.path(), "").unwrap();
    assert_eq!(
        read(root.path(), "pages/index.md"),
        "type:: system\ndescription:: Catalogue of pages.\n"
    );
    assert_eq!(
        execute("lint", root.path(), "").unwrap(),
        "Wiki checks passed.\n"
    );
    assert!(!root.path().join("pages/log.md").exists());
    assert!(!root.path().join(".graphwiki").exists());
}

#[test]
fn publishes_exact_markdown_and_derived_pages_without_touching_sources() {
    let root = fixture();
    let output = execute("publish", root.path(), "first").unwrap();
    assert!(output.contains("Published first"));
    assert_eq!(read(root.path(), "pages/source.md"), SOURCE);
    assert_eq!(read(root.path(), "pages/topic.md"), TOPIC);
    assert_eq!(
        read(root.path(), "assets/sources/original.txt"),
        "Original evidence bytes"
    );
    assert_eq!(read(root.path(), ".drafts/first/pages/source.md"), SOURCE);
    assert_catalogue_and_log(root.path());
    execute("lint", root.path(), "").unwrap();
}

fn assert_catalogue_and_log(root: &Path) {
    let index = read(root, "pages/index.md");
    assert!(index.contains("[[source]] — Original evidence."));
    assert!(index.contains("[[topic]] — A test topic."));
    let log = read(root, "pages/log.md");
    assert!(log.starts_with("type:: system\n\n- Earlier history\n"));
    assert!(log.contains("  change:: first\n"));
}

#[test]
fn completed_batch_is_idempotent_and_rejects_changed_contents() {
    let root = fixture();
    execute("publish", root.path(), "first").unwrap();
    let log = read(root.path(), "pages/log.md");
    assert!(execute("publish", root.path(), "first")
        .unwrap()
        .contains("already published"));
    assert_eq!(read(root.path(), "pages/log.md"), log);
    fs::write(
        root.path().join(".drafts/first/pages/topic.md"),
        TOPIC.replace("Needle", "Changed"),
    )
    .unwrap();
    assert!(execute("publish", root.path(), "first")
        .unwrap_err()
        .contains("different contents"));
    assert_eq!(read(root.path(), "pages/topic.md"), TOPIC);
    assert_eq!(read(root.path(), "pages/log.md"), log);
}

#[test]
fn replaying_an_old_batch_does_not_revert_later_updates() {
    let root = fixture();
    execute("publish", root.path(), "first").unwrap();
    let revised = TOPIC.replace("Needle", "Revision");
    draft(root.path(), "second", &revised);
    execute("publish", root.path(), "second").unwrap();
    execute("publish", root.path(), "first").unwrap();
    assert_eq!(read(root.path(), "pages/topic.md"), revised);
    assert_eq!(
        read(root.path(), "pages/log.md")
            .matches("  change:: ")
            .count(),
        2
    );
}

#[test]
fn invalid_batch_leaves_published_files_and_receipts_untouched() {
    let root = fixture();
    let before_index = read(root.path(), "pages/index.md");
    let before_log = read(root.path(), "pages/log.md");
    draft(root.path(), "first", &format!("title:: source\n{TOPIC}"));
    assert!(execute("publish", root.path(), "first")
        .unwrap_err()
        .contains("Duplicate Logseq page title"));
    assert_eq!(read(root.path(), "pages/index.md"), before_index);
    assert_eq!(read(root.path(), "pages/log.md"), before_log);
    assert!(!root.path().join("pages/source.md").exists());
    assert!(!root.path().join(".graphwiki").exists());
}

#[test]
fn unavailable_originals_and_absent_descriptions_are_valid() {
    let root = fixture();
    fs::remove_file(root.path().join("assets/sources/original.txt")).unwrap();
    let path = root.path().join(".drafts/first/pages/source.md");
    let source = SOURCE.replace("description:: Original evidence.\n", "");
    fs::write(path, &source).unwrap();
    execute("publish", root.path(), "first").unwrap();
    execute("lint", root.path(), "").unwrap();
    assert_eq!(read(root.path(), "pages/source.md"), source);
    assert!(read(root.path(), "pages/index.md").contains("- [[source]]\n"));
    assert!(!root.path().join("assets/sources/original.txt").exists());
}

#[test]
fn context_is_literal_sorted_and_includes_each_source_once() {
    let root = fixture();
    execute("publish", root.path(), "first").unwrap();
    let context = execute("context", root.path(), "NEEDLE [x]").unwrap();
    assert_eq!(
        context,
        format!("--- pages/source.md ---\n{SOURCE}\n--- pages/topic.md ---\n{TOPIC}\n")
    );
    assert_eq!(
        execute("context", root.path(), "not-here").unwrap(),
        "No matching pages.\n"
    );
    assert!(execute("context", root.path(), " ").is_err());
    assert_eq!(
        execute("context", root.path(), "Earlier history").unwrap(),
        "No matching pages.\n"
    );
}

#[test]
fn inline_and_fenced_code_do_not_create_references() {
    let root = fixture();
    let topic = format!("{TOPIC}- An example: `[[inline-ghost]]`.\n- Code\n  ```text\n  [[fenced-ghost]]\n  ```\n- Follow [[unwritten]].\n");
    draft(root.path(), "first", &topic);
    execute("publish", root.path(), "first").unwrap();
    let result = execute("lint", root.path(), "").unwrap();
    assert!(result.contains("unwritten"));
    assert!(!result.contains("inline-ghost"));
    assert!(!result.contains("fenced-ghost"));
    assert!(!result.contains("orphan"));
}

#[test]
fn index_regeneration_is_deterministic() {
    let root = fixture();
    execute("publish", root.path(), "first").unwrap();
    let expected = read(root.path(), "pages/index.md");
    execute("index", root.path(), "").unwrap();
    execute("index", root.path(), "").unwrap();
    assert_eq!(read(root.path(), "pages/index.md"), expected);
}

#[test]
fn published_pages_with_missing_type_pass_lint() {
    let root = fixture();
    execute("publish", root.path(), "first").unwrap();
    fs::write(
        root.path().join("pages/topic.md"),
        TOPIC.replace("type:: topic\n", ""),
    )
    .unwrap();
    assert_eq!(
        execute("lint", root.path(), "").unwrap(),
        "Wiki checks passed.\n"
    );
}

#[test]
fn title_properties_and_case_insensitive_references_agree_with_logseq() {
    let root = fixture();
    fs::write(
        root.path().join(".drafts/first/pages/source.md"),
        format!("title:: Original Evidence\n{SOURCE}"),
    )
    .unwrap();
    fs::write(
        root.path().join(".drafts/first/pages/topic.md"),
        TOPIC.replace("[[source]]", "[[ORIGINAL EVIDENCE]]"),
    )
    .unwrap();
    execute("publish", root.path(), "first").unwrap();
    assert!(read(root.path(), "pages/index.md").contains("[[Original Evidence]]"));
    assert!(execute("context", root.path(), "needle")
        .unwrap()
        .contains("pages/source.md"));
}

#[test]
fn duplicate_properties_and_titles_are_rejected() {
    let root = fixture();
    fs::write(
        root.path().join(".drafts/first/pages/source.md"),
        format!("TYPE:: source\n{SOURCE}"),
    )
    .unwrap();
    assert!(execute("publish", root.path(), "first")
        .unwrap_err()
        .contains("duplicate page property"));
    fs::write(
        root.path().join(".drafts/first/pages/source.md"),
        format!("title:: topic\n{SOURCE}"),
    )
    .unwrap();
    assert!(execute("publish", root.path(), "first")
        .unwrap_err()
        .contains("Duplicate Logseq page title"));
}

#[test]
fn citation_forms_and_arbitrary_metadata_are_preserved_without_local_files() {
    let citations = [
        "An oral account recorded during a visit.",
        "Bede, Historia ecclesiastica, book IV, chapter 23.",
        "https://example.invalid/archive/42",
        "[Inventory](../assets/unavailable%20record.pdf)",
        "[[unwritten]]; Bede, book IV; https://example.invalid/archive/42",
    ];
    for citation in citations {
        let root = empty_graph();
        let content = format!("type:: charter\ncustom-field:: kept\noriginal:: {citation}\nsources:: {citation}\n\n- Interpretation.\n");
        batch(root.path(), "first", &[("record", &content)]);
        execute("publish", root.path(), "first").unwrap();
        execute("lint", root.path(), "").unwrap();
        assert_eq!(read(root.path(), "pages/record.md"), content);
        assert!(!root.path().join("assets").exists());
    }
}

#[test]
fn external_originals_stay_in_place_and_can_be_unavailable() {
    let root = fixture();
    let external = tempfile::tempdir().unwrap();
    let original = external.path().join("original file.txt");
    fs::write(&original, "External evidence").unwrap();
    let directory = external.path().file_name().unwrap().to_str().unwrap();
    let target = format!("../../{directory}/original%20file.txt");
    let source = SOURCE.replace("../assets/sources/original.txt", &target);
    fs::write(root.path().join(".drafts/first/pages/source.md"), &source).unwrap();
    execute("publish", root.path(), "first").unwrap();
    assert_eq!(read(root.path(), "pages/source.md"), source);
    assert_eq!(fs::read_to_string(&original).unwrap(), "External evidence");
    assert!(!root
        .path()
        .join("assets/sources/original file.txt")
        .exists());
    execute("lint", root.path(), "").unwrap();
    fs::remove_file(original).unwrap();
    execute("lint", root.path(), "").unwrap();
}

#[test]
fn plain_markdown_publishes_exactly_without_metadata_or_source_directories() {
    let root = empty_graph();
    let content = "# Priory study\r\n\r\nA tentative interpretation.\r\n";
    batch(root.path(), "first", &[("research-notes", content)]);
    execute("publish", root.path(), "first").unwrap();
    assert_eq!(read(root.path(), "pages/research-notes.md"), content);
    assert_eq!(
        execute("lint", root.path(), "").unwrap(),
        "Wiki checks passed.\n"
    );
    assert_eq!(
        execute("context", root.path(), "tentative").unwrap(),
        format!("--- pages/research-notes.md ---\n{content}\n")
    );
    assert!(root.path().join(".graphwiki/receipts/first").is_file());
    assert!(!root.path().join("assets").exists());
}

#[test]
fn context_includes_resolved_sources_of_any_type_and_skips_unresolved_links() {
    let root = empty_graph();
    let notes = "sources:: [[chronicle]], [[CHARTER]], [[missing]], [[chronicle]]\n\n- Distinctive phrase.\n";
    let chronicle = "A transcription.\n";
    let charter = "type:: charter\n\n- An undated instrument.\n";
    batch(
        root.path(),
        "first",
        &[
            ("notes", notes),
            ("chronicle", chronicle),
            ("charter", charter),
        ],
    );
    let output = execute("publish", root.path(), "first").unwrap();
    assert!(output.contains("warning: pages/notes.md: unresolved [[missing]]"));
    assert_eq!(
        execute("context", root.path(), "distinctive phrase").unwrap(),
        format!("--- pages/charter.md ---\n{charter}\n--- pages/chronicle.md ---\n{chronicle}\n--- pages/notes.md ---\n{notes}\n")
    );
    assert_eq!(
        execute("lint", root.path(), "").unwrap(),
        "warning: pages/notes.md: unresolved [[missing]]\nWiki checks passed.\n"
    );
}

#[test]
fn index_includes_all_pages_sorted_by_filename_with_optional_titles_and_descriptions() {
    let root = empty_graph();
    batch(
        root.path(),
        "first",
        &[
            (
                "alpha",
                "title:: Zeta\ndescription:: An account.\n\n- Account.\n",
            ),
            ("beta", "title::   \ndescription::   \n\n- Untitled.\n"),
            ("gamma", "type:: custom\n\n- Notes.\n"),
        ],
    );
    execute("publish", root.path(), "first").unwrap();
    let expected = "type:: system\ndescription:: Catalogue of pages.\n\n- [[Zeta]] — An account.\n- [[beta]]\n- [[gamma]]\n";
    assert_eq!(read(root.path(), "pages/index.md"), expected);
    execute("index", root.path(), "").unwrap();
    assert_eq!(read(root.path(), "pages/index.md"), expected);
}

#[test]
fn binary_shows_usage_without_arguments_or_with_help_flags() {
    for args in [vec![], vec!["--help"], vec!["-h"]] {
        let output = Command::new(env!("CARGO_BIN_EXE_graphwiki"))
            .args(args)
            .output()
            .unwrap();
        assert!(output.status.success());
        let text = String::from_utf8(output.stdout).unwrap();
        assert!(text.contains("Usage: graphwiki"));
        assert!(text.contains("context <graph-root> <query>"));
        assert!(output.stderr.is_empty());
    }
}

#[test]
fn unsafe_change_names_and_system_page_overwrites_are_rejected() {
    let root = fixture();
    for name in ["../outside", "", "a/b", "UPPER", "--", "a--b"] {
        assert!(execute("publish", root.path(), name).is_err());
    }
    for name in ["index", "log"] {
        let file = root.path().join(format!(".drafts/first/pages/{name}.md"));
        fs::write(&file, TOPIC).unwrap();
        assert!(execute("publish", root.path(), "first").is_err());
        fs::remove_file(file).unwrap();
    }
}

#[test]
fn reserved_system_titles_are_rejected_before_first_publication_writes() {
    for title in ["index", "INDEX", "log", "Log"] {
        let root = empty_graph();
        batch(
            root.path(),
            "first",
            &[("study", &format!("title:: {title}\n\n- A study.\n"))],
        );
        assert!(execute("publish", root.path(), "first")
            .unwrap_err()
            .contains("Duplicate Logseq page title"));
        assert_eq!(fs::read_dir(root.path().join("pages")).unwrap().count(), 0);
        assert!(!root.path().join(".graphwiki").exists());
    }
}

#[cfg(unix)]
#[test]
fn dangling_symlink_destination_is_rejected_before_any_page_is_written() {
    let root = fixture();
    let outside = root.path().join("outside.md");
    std::os::unix::fs::symlink(&outside, root.path().join("pages/topic.md")).unwrap();
    assert!(execute("publish", root.path(), "first")
        .unwrap_err()
        .contains("Symlinks"));
    assert!(!root.path().join("pages/source.md").exists());
    assert!(!outside.exists());
}

#[cfg(unix)]
#[test]
fn symlink_parent_directory_is_rejected() {
    let root = fixture();
    fs::rename(root.path().join("pages"), root.path().join("elsewhere")).unwrap();
    std::os::unix::fs::symlink(root.path().join("elsewhere"), root.path().join("pages")).unwrap();
    assert!(execute("publish", root.path(), "first")
        .unwrap_err()
        .contains("Symlinks"));
    assert!(!root.path().join("elsewhere/source.md").exists());
}
