use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

use crate::{page::Page, storage, Result};

#[derive(Default)]
pub struct Graph {
    pub pages: BTreeMap<String, Page>,
}

impl Graph {
    pub fn load(root: &Path) -> Result<Self> {
        let mut graph = Self::from_directory(&storage::path(root, "pages")?, "pages")?;
        graph
            .pages
            .extend(Self::optional_directory(root, "journals")?.pages);
        Ok(graph)
    }

    fn optional_directory(root: &Path, section: &'static str) -> Result<Self> {
        let directory = storage::path(root, section)?;
        if !directory.try_exists().map_err(|error| error.to_string())? {
            return Ok(Self::default());
        }
        Self::from_directory(&directory, section)
    }

    pub fn from_directory(directory: &Path, section: &'static str) -> Result<Self> {
        let pages = storage::markdown_files(directory)?
            .iter()
            .map(|path| Page::load(path, section).map(|page| (page.key(), page)))
            .collect::<Result<BTreeMap<_, _>>>()?;
        Ok(Self { pages })
    }

    pub fn resolve(&self, reference: &str) -> Option<&Page> {
        self.pages
            .values()
            .find(|page| page.title().to_lowercase() == reference.to_lowercase())
    }

    pub fn validate(&self) -> Result<Vec<String>> {
        let mut titles = BTreeSet::new();
        let errors: Vec<_> = self
            .pages
            .values()
            .filter_map(|page| title_error(page, &mut titles))
            .collect();
        if !errors.is_empty() {
            return Err(errors.join("\n"));
        }
        Ok(self.warnings())
    }

    fn warnings(&self) -> Vec<String> {
        self.pages
            .values()
            .filter(|page| !page.system())
            .flat_map(|page| self.unresolved(page))
            .collect()
    }

    fn unresolved(&self, page: &Page) -> Vec<String> {
        page.references
            .iter()
            .filter(|reference| self.resolve(reference).is_none())
            .map(|reference| format!("warning: {}: unresolved [[{reference}]]\n", page.path()))
            .collect()
    }

    pub fn context(&self, query: &str) -> Result<String> {
        let query = query.trim().to_lowercase();
        if query.is_empty() {
            return Err("Set QUERY to a nonempty literal search phrase".into());
        }
        let mut selected = BTreeSet::new();
        for page in self
            .pages
            .values()
            .filter(|page| !page.system() && page.matches(&query))
        {
            selected.insert(page.key());
            self.select_sources(page, &mut selected);
        }
        if selected.is_empty() {
            return Ok("No matching pages.\n".into());
        }
        Ok(selected
            .iter()
            .map(|key| {
                let page = &self.pages[key];
                format!("--- {} ---\n{}\n", page.path(), page.content)
            })
            .collect())
    }

    fn select_sources(&self, page: &Page, selected: &mut BTreeSet<String>) {
        selected.extend(
            page.sources()
                .iter()
                .filter_map(|reference| self.resolve(reference))
                .map(Page::key),
        );
    }

    pub fn index(&self) -> String {
        let mut result = String::from("type:: system\ndescription:: Catalogue of pages.\n\n");
        for page in self
            .pages
            .values()
            .filter(|page| !page.system() && !page.journal())
        {
            result.push_str(&format!("- [[{}]]", page.title()));
            if let Some(description) = page.property("description") {
                result.push_str(&format!(" — {description}"));
            }
            result.push('\n');
        }
        result.truncate(result.trim_end_matches('\n').len());
        result.push('\n');
        result
    }
}

fn title_error(page: &Page, titles: &mut BTreeSet<String>) -> Option<String> {
    let title = page.title().to_lowercase();
    let duplicate = !titles.insert(title.clone());
    let reserved = !page.system() && matches!(title.as_str(), "index" | "log");
    (duplicate || reserved).then(|| format!("Duplicate Logseq page title: {}", page.title()))
}
