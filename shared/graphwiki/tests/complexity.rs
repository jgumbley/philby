use std::{
    fs,
    path::{Path, PathBuf},
};

use rust_code_analysis::{metrics, FuncSpace, ParserTrait, RustParser, SpaceKind};

const LIMIT: f64 = 5.0;

fn rust_files(directory: &Path, files: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(directory).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            rust_files(&path, files);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            files.push(path);
        }
    }
}

fn violations(space: &FuncSpace, path: &Path, failures: &mut Vec<String>) {
    let complexity = space.metrics.cyclomatic.cyclomatic();
    if space.kind == SpaceKind::Function && complexity > LIMIT {
        failures.push(format!(
            "{}:{}: {} has cyclomatic complexity {complexity} (limit {LIMIT})",
            path.display(),
            space.start_line,
            space.name.as_deref().unwrap_or("closure")
        ));
    }
    for child in &space.spaces {
        violations(child, path, failures);
    }
}

fn analyze(path: &Path, code: Vec<u8>) -> FuncSpace {
    let parser = RustParser::new(code, path, None);
    metrics(&parser, path).expect("Rust source must produce function metrics")
}

#[test]
fn rust_sources_contain_no_code_comments() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut files = Vec::new();
    rust_files(&root.join("src"), &mut files);
    rust_files(&root.join("tests"), &mut files);
    for path in files {
        let space = analyze(&path, fs::read(&path).unwrap());
        assert_eq!(
            space.metrics.loc.cloc(),
            0.0,
            "Code comments in {}",
            path.display()
        );
    }
}

#[test]
fn all_rust_functions_have_cyclomatic_complexity_at_most_five() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut files = Vec::new();
    rust_files(&root.join("src"), &mut files);
    rust_files(&root.join("tests"), &mut files);
    files.sort();
    assert!(!files.is_empty());
    let mut failures = Vec::new();
    for path in &files {
        let space = analyze(path, fs::read(path).unwrap());
        violations(&space, path, &mut failures);
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    println!(
        "Cyclomatic complexity <= {LIMIT}: checked {} Rust files",
        files.len()
    );
}

#[test]
fn complexity_gate_detects_branches_instead_of_counting_text() {
    let path = Path::new("fixture.rs");
    let code = br#"fn branchy(x: i32) -> i32 {
        if x == 0 { return 0; }
        if x == 1 { return 1; }
        if x == 2 { return 2; }
        if x == 3 { return 3; }
        if x == 4 { return 4; }
        5
    }
    fn plain() -> &'static str { "if while for match" }
    "#;
    let space = analyze(path, code.to_vec());
    let mut failures = Vec::new();
    violations(&space, path, &mut failures);
    assert_eq!(failures.len(), 1);
    assert!(failures[0].contains("branchy"));
}
