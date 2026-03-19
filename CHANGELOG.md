# Changelog

## [0.0.2](https://github.com/tsdrivers/mssql/compare/@tsdrivers/mssql-v0.0.1...@tsdrivers/mssql-v0.0.2) (2026-03-19)


### Features

* Blob Streaming — cross-platform VARBINARY(MAX) chunked read/write via cn.blob.* ([62258d8](https://github.com/tsdrivers/mssql/commit/62258d8e742ca25d2f826d5951d4c2a8028804e1))
* ODBC Driver Migration — replaced mssql-client/TDS with Microsoft ODBC Driver 18 ([62258d8](https://github.com/tsdrivers/mssql/commit/62258d8e742ca25d2f826d5951d4c2a8028804e1))
* Sub-object API — clean cn.fs.* and cn.blob.filestream.* / cn.blob.webstream.* ([62258d8](https://github.com/tsdrivers/mssql/commit/62258d8e742ca25d2f826d5951d4c2a8028804e1))


### Bug Fixes

* 289 tests passing across Deno, Node.js, and Bun ([62258d8](https://github.com/tsdrivers/mssql/commit/62258d8e742ca25d2f826d5951d4c2a8028804e1))
* add pipeline tests for blob stream methods ([02b3403](https://github.com/tsdrivers/mssql/commit/02b3403367922df5039eb4421a75afc8902c154c))
* async ffi calls, use koffi with bun ([11d2980](https://github.com/tsdrivers/mssql/commit/11d298021147ae161f08978121435fef921205d4))
* Empty VARBINARY fix — parameterized empty Uint8Array now works ([62258d8](https://github.com/tsdrivers/mssql/commit/62258d8e742ca25d2f826d5951d4c2a8028804e1))
* FILESTREAM — migrated from OLE DB to ODBC driver DLL, no extra installs needed ([62258d8](https://github.com/tsdrivers/mssql/commit/62258d8e742ca25d2f826d5951d4c2a8028804e1))
* linting and formatting issues ([66f36b5](https://github.com/tsdrivers/mssql/commit/66f36b5269c561aae12e5b4976e8269ec55c38fa))
* more windows tweak ([ae86923](https://github.com/tsdrivers/mssql/commit/ae86923571319450fd0a23ca93d856e4e5131581))
* remove unneccessary utf-8 collation helpers ([80484e3](https://github.com/tsdrivers/mssql/commit/80484e3ce21b938dccc83b3ab243b1e8b73396a9))
* rename the projects in preparation for future work ([02b3403](https://github.com/tsdrivers/mssql/commit/02b3403367922df5039eb4421a75afc8902c154c))
* Start of implementation, mostly implemented, need builds etc. ([7c88a54](https://github.com/tsdrivers/mssql/commit/7c88a545fa7269b3bc0ea8c0c989b3b4bf69a34e))
* structure and todo updates ([27e0b3f](https://github.com/tsdrivers/mssql/commit/27e0b3f9785b57b9b2e9941bf0e91fe732a3a891))
* tighten public api surface ([30a5fd0](https://github.com/tsdrivers/mssql/commit/30a5fd0c459500055cad7f846e0c6468b3643596))
* update the publish/reference names to use the tsdrivers org package name. ([3ebfd26](https://github.com/tsdrivers/mssql/commit/3ebfd26edd3706ccaee7b447c1061f96da425b39))
* update workflow deps ([a67b6e0](https://github.com/tsdrivers/mssql/commit/a67b6e00c2900ec08986d2be2ae288874e0a143e))
* Windows Auth — works natively via Trusted_Connection=yes (SSPI on Windows, Kerberos on Linux) ([62258d8](https://github.com/tsdrivers/mssql/commit/62258d8e742ca25d2f826d5951d4c2a8028804e1))
* windows tweak ([1e2ba5f](https://github.com/tsdrivers/mssql/commit/1e2ba5f958aed10a0065a80edc330684a32f0249))
