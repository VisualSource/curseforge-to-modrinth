import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
    output: {
        format: "prettier",
        path: "./src/api/modrinth",
    },
    client: "axios",
    input: "https://docs.modrinth.com/redocusaurus/plugin-redoc-0.yaml",
    schemas: false
});