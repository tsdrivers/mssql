import { defineConfig } from "vitepress";

export default defineConfig({
  title: "mssql-ts-ffi",
  description: "SQL Server driver for Deno, Node.js 22+, and Bun via Rust FFI",
  base: "/mssql-ts-ffi/",

  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "API", link: "/api/" },
      {
        text: "GitHub",
        link: "https://github.com/tracker1/mssql-ts-ffi",
      },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Introduction",
          items: [
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Installation", link: "/guide/installation" },
          ],
        },
        {
          text: "Usage",
          items: [
            { text: "Connections", link: "/guide/connections" },
            { text: "Queries", link: "/guide/queries" },
            { text: "Transactions", link: "/guide/transactions" },
            { text: "Streaming", link: "/guide/streaming" },
            { text: "Bulk Insert", link: "/guide/bulk-insert" },
            { text: "Connection Pooling", link: "/guide/pooling" },
          ],
        },
        {
          text: "Advanced",
          items: [
            { text: "COMB UUIDs", link: "/guide/comb" },
            { text: "UTF-8 Collation", link: "/guide/utf8" },
            { text: "FILESTREAM", link: "/guide/filestream" },
            {
              text: "Runtime Support",
              link: "/guide/runtime-packages",
            },
          ],
        },
      ],
      "/api/": [
        {
          text: "API Reference",
          link: "/api/",
        },
        {
          text: "Classes",
          collapsed: false,
          items: [
            { text: "MssqlConnection", link: "/api/classes/MssqlConnection" },
            { text: "MssqlPool", link: "/api/classes/MssqlPool" },
            { text: "Transaction", link: "/api/classes/Transaction" },
            { text: "QueryStream", link: "/api/classes/QueryStream" },
            { text: "PooledQueryStream", link: "/api/classes/PooledQueryStream" },
            { text: "BulkInsertBuilder", link: "/api/classes/BulkInsertBuilder" },
            { text: "FilestreamHandle", link: "/api/classes/FilestreamHandle" },
          ],
        },
        {
          text: "Interfaces",
          collapsed: false,
          items: [
            { text: "MssqlConfig", link: "/api/interfaces/MssqlConfig" },
            { text: "CommandOptions", link: "/api/interfaces/CommandOptions" },
            { text: "BulkColumn", link: "/api/interfaces/BulkColumn" },
            { text: "TypedParam", link: "/api/interfaces/TypedParam" },
            { text: "ResolutionContext", link: "/api/interfaces/ResolutionContext" },
            { text: "RuntimeFFI", link: "/api/interfaces/RuntimeFFI" },
            { text: "RuntimeInfo", link: "/api/interfaces/RuntimeInfo" },
          ],
        },
        {
          text: "Type Aliases",
          collapsed: true,
          items: [
            { text: "SqlType", link: "/api/type-aliases/SqlType" },
            { text: "IsolationLevel", link: "/api/type-aliases/IsolationLevel" },
            { text: "Params", link: "/api/type-aliases/Params" },
            { text: "ParamValue", link: "/api/type-aliases/ParamValue" },
            { text: "CommandType", link: "/api/type-aliases/CommandType" },
            { text: "FilestreamMode", link: "/api/type-aliases/FilestreamMode" },
            { text: "Utf8Collation", link: "/api/type-aliases/Utf8Collation" },
          ],
        },
        {
          text: "Functions",
          collapsed: true,
          items: [
            { text: "newCOMB", link: "/api/functions/newCOMB" },
            { text: "parseConnection", link: "/api/functions/parseConnection" },
            { text: "resolveLibraryPath", link: "/api/functions/resolveLibraryPath" },
            { text: "libraryFileName", link: "/api/functions/libraryFileName" },
            { text: "downloadUrl", link: "/api/functions/downloadUrl" },
            { text: "utf8Column", link: "/api/functions/utf8Column" },
            { text: "supportsUtf8", link: "/api/functions/supportsUtf8" },
            { text: "setDatabaseUtf8", link: "/api/functions/setDatabaseUtf8" },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/tracker1/mssql-ts-ffi" },
    ],
  },
});
