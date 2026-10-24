mod graph;
mod page;
mod publish;
mod storage;

use std::path::Path;

pub type Result<T> = std::result::Result<T, String>;

pub fn execute(operation: &str, root: &Path, argument: &str) -> Result<String> {
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    if operation == "publish" {
        return publish::publish(&root, argument);
    }
    publish::require_complete(&root)?;
    let graph = graph::Graph::load(&root)?;
    execute_read(operation, &root, &graph, argument)
}

fn execute_read(
    operation: &str,
    root: &Path,
    graph: &graph::Graph,
    argument: &str,
) -> Result<String> {
    match operation {
        "context" => graph.context(argument),
        "lint" => graph
            .validate()
            .map(|warnings| format!("{}Wiki checks passed.\n", warnings.join(""))),
        "index" => write_index(root, graph),
        _ => Err(format!("Unknown wiki operation: {operation}")),
    }
}

fn write_index(root: &Path, graph: &graph::Graph) -> Result<String> {
    graph.validate()?;
    let path = storage::path(root, "pages/index.md")?;
    storage::replace(&path, &graph.index())?;
    Ok("Updated pages/index.md\n".into())
}
