// Re-export from the new module registry to keep backward compat for any
// callers still importing AppPage / ALL_PAGE_HREFS / DEFAULT_NON_ADMIN_PAGES
// from this file.
export {
  ALL_PAGES as APP_PAGES,
  ALL_PAGE_HREFS,
  DEFAULT_NON_ADMIN_PAGES,
  type AppPage,
} from "./modules";
