// Static hosting explicitly selects synthetic demo data.
// Node serves its own authenticated runtime module with SOURCE_MODE="server".
// Never switch modes as a fallback after a failed API request.
export const SOURCE_MODE = "static-demo";
