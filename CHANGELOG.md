# [3.53.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.52.0...v3.53.0) (2026-04-07)


### Features

* **mcp:** add Chrome extension documentation and improve path matching ([128b0d3](https://github.com/glorynguyen/ollama-code-review/commit/128b0d3e6182e13d23681ea900bd250bb50208cc))

# [3.52.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.51.0...v3.52.0) (2026-04-07)


### Features

* **chrome-extension:** add Slack notification feature ([e444a21](https://github.com/glorynguyen/ollama-code-review/commit/e444a2142d16c0e02bf74398e1b1c980f9d1e33c))

# [3.51.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.50.0...v3.51.0) (2026-04-07)


### Features

* **chrome-extension:** add prompt mode and light check criteria support ([b116a0b](https://github.com/glorynguyen/ollama-code-review/commit/b116a0b526513d6c00ddf49cfd974b34e7e53391))

# [3.50.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.49.0...v3.50.0) (2026-04-07)


### Features

* **mcp-client:** add get_commit_review_bundle tool for commit-level code reviews ([c558f57](https://github.com/glorynguyen/ollama-code-review/commit/c558f57fabe53b94f9735d118c6fcf63f33d888a))
* **mcp:** add commit prompt bundle endpoint with chunked diff analysis ([34ba468](https://github.com/glorynguyen/ollama-code-review/commit/34ba468c485de491b37e07b3ad2091e3ff79ac49))

# [3.49.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.48.0...v3.49.0) (2026-04-07)


### Features

* **review:** centralise prompt builder and add cancellable review UI ([fb68ba9](https://github.com/glorynguyen/ollama-code-review/commit/fb68ba9b8a3170fe95bf0aa6b7acc0d537def83c))

# [3.48.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.47.0...v3.48.0) (2026-04-07)


### Features

* **chrome-extension:** add base ref hint element and update logic ([d7bea17](https://github.com/glorynguyen/ollama-code-review/commit/d7bea1782a37454ae8456a9b3ec54edb5e74eb34))
* **chrome-extension:** add MCP status and test result UI elements ([ef9124b](https://github.com/glorynguyen/ollama-code-review/commit/ef9124bfb2608df0c9078a70f6e6823d7d953f85))
* **chrome-extension:** add support for fetching repository defaults ([a20e1b9](https://github.com/glorynguyen/ollama-code-review/commit/a20e1b9dcbf1b7e8ed498a74a4c613551435bf65))
* **ollama-code-review:** add default base branch configuration and conditional prompt copying ([d511423](https://github.com/glorynguyen/ollama-code-review/commit/d5114235d9c0447ce981836a2aab097054ecf589))

# [3.47.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.46.0...v3.47.0) (2026-04-06)


### Features

* **chrome-extension:** add commit message generation and application functionality ([66a3eaa](https://github.com/glorynguyen/ollama-code-review/commit/66a3eaa9571110cda1050aa9e0e9be4017899138))

# [3.46.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.45.0...v3.46.0) (2026-04-06)


### Features

* add overlay functionality for AI review in Chrome extension ([8426bd7](https://github.com/glorynguyen/ollama-code-review/commit/8426bd79add954d7c6d88cf491cbbc464844eb4f))

# [3.45.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.44.0...v3.45.0) (2026-04-06)


### Features

* **mcp:** add auto-kill port conflict resolution on server start ([935c6c3](https://github.com/glorynguyen/ollama-code-review/commit/935c6c3c4ec0582c940d73ce317188cdc1a67553))

# [3.44.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.43.1...v3.44.0) (2026-04-02)


### Features

* **reviewTools:** add 'get_branch_diff' tool to compare Git branches with filtered output ([8841716](https://github.com/glorynguyen/ollama-code-review/commit/8841716855c969313df7a1adcb31e22f858a7303))

## [3.43.1](https://github.com/glorynguyen/ollama-code-review/compare/v3.43.0...v3.43.1) (2026-04-01)


### Bug Fixes

* **mcp:** use per-request transport for SDK v1.29+ compatibility ([a995bfb](https://github.com/glorynguyen/ollama-code-review/commit/a995bfba6dd4f40f8ed14e361a8fd7a0da01f8a7))

# [3.43.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.42.0...v3.43.0) (2026-04-01)


### Features

* **mcp:** add MCP server for Claude Code integration ([d970fad](https://github.com/glorynguyen/ollama-code-review/commit/d970fad88ed22f313835ebe9f5d1590004e75e34))

# [3.42.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.41.1...v3.42.0) (2026-03-28)


### Features

* **commands:** opt-out and scope fix ([55adcfe](https://github.com/glorynguyen/ollama-code-review/commit/55adcfead0341dc86620e7f151e76e048dd2a249))

## [3.41.1](https://github.com/glorynguyen/ollama-code-review/compare/v3.41.0...v3.41.1) (2026-03-27)


### Bug Fixes

* **diff:** fix glob matching and apply filters ([2f70e63](https://github.com/glorynguyen/ollama-code-review/commit/2f70e639ddb2400e1182a9bb91994ca40c01ca52))

# [3.41.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.40.0...v3.41.0) (2026-03-26)


### Features

* **findings:** add severity filter and Markdown export (F-034) ([b39b1a0](https://github.com/glorynguyen/ollama-code-review/commit/b39b1a094344bee2ed4bdf919161d3c3a2c47f36))

# [3.40.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.39.0...v3.40.0) (2026-03-25)


### Features

* **secret-scanner:** add entropy filtering ([fc31e7a](https://github.com/glorynguyen/ollama-code-review/commit/fc31e7a07a9defbbe84717ab51cfab55c6c5ad99)), closes [hi#entropy](https://github.com/hi/issues/entropy)

# [3.39.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.38.1...v3.39.0) (2026-03-24)


### Features

* **commands:** copy prompts to clipboard ([c286295](https://github.com/glorynguyen/ollama-code-review/commit/c286295a30cabb7fe6c3f169d5c6944ccbf4f3ae))

## [3.38.1](https://github.com/glorynguyen/ollama-code-review/compare/v3.38.0...v3.38.1) (2026-03-23)


### Bug Fixes

* **models:** exclude cloud GLM variants ([8c35201](https://github.com/glorynguyen/ollama-code-review/commit/8c35201511c16e93f6742b9f35a038f753e86735))

# [3.38.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.37.0...v3.38.0) (2026-03-22)


### Features

* **findings:** [F-044] add diff viewer command ([966d701](https://github.com/glorynguyen/ollama-code-review/commit/966d70160e0d7433e40921968d6f2f4b58e1a8ac))

# [3.37.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.36.0...v3.37.0) (2026-03-22)


### Features

* **commands:** support monorepo imports ([423b570](https://github.com/glorynguyen/ollama-code-review/commit/423b5706697babe8a20bd6a096507668175ce9c8))

# [3.36.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.35.0...v3.36.0) (2026-03-21)


### Features

* add copy function with imports ([53b63d4](https://github.com/glorynguyen/ollama-code-review/commit/53b63d420918298bd205fa5e1d9399533533c048))

# [3.35.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.34.0...v3.35.0) (2026-03-20)


### Features

* add Ollama setup guide for first-time users ([979bd2c](https://github.com/glorynguyen/ollama-code-review/commit/979bd2cb75ae81b10ab42afd7660d0e33ecac0e7))

# [3.34.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.33.0...v3.34.0) (2026-03-20)


### Features

* [F-043] add auto-review on save — background code quality monitor ([ff58ef8](https://github.com/glorynguyen/ollama-code-review/commit/ff58ef8b683e165e510b506df5e49d35414fa38b))
* [F-043] add confirmBeforeReview prompt to auto-review on save ([4197659](https://github.com/glorynguyen/ollama-code-review/commit/419765942ae8a588e3d80c330c195e7863d0f2f8))
* [F-043] add content cache and LCS diff to auto-review to reduce token usage ([c070cc8](https://github.com/glorynguyen/ollama-code-review/commit/c070cc85b37bc8cec4a23819cffc6bb906887fcc))
* [F-043] add monorepo-aware import resolution for smart context ([bda2923](https://github.com/glorynguyen/ollama-code-review/commit/bda2923f640c27a7af7af315c8bfade36dcea707))
* [F-043] replace LCS diff with git diff + smart context builder ([4fa5892](https://github.com/glorynguyen/ollama-code-review/commit/4fa589270a450c18fd66a0ec82283c567742ef48))

# [3.33.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.32.0...v3.33.0) (2026-03-17)


### Features

* [F-037] add model advisor for auto-selection ([e642ed2](https://github.com/glorynguyen/ollama-code-review/commit/e642ed2d2b49135cf46e6b5446352d9c7078c3e6))
* **security:** [F-042] add AI-powered secret scanner with regex detection ([636c776](https://github.com/glorynguyen/ollama-code-review/commit/636c776ab5823ce5ef738721045bce27f15fd7df))

# [3.32.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.31.0...v3.32.0) (2026-03-11)


### Features

* **config:** [HWWW-XXX] add per-folder project code support ([5200c44](https://github.com/glorynguyen/ollama-code-review/commit/5200c4474a699c913dc47f5a3ccc7cde29029c55))

# [3.31.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.30.0...v3.31.0) (2026-03-10)


### Features

* add Jira ticket integration for commit messages ([287cf2e](https://github.com/glorynguyen/ollama-code-review/commit/287cf2eb2416b31fc39996841964331086eab6ec))

# [3.30.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.29.0...v3.30.0) (2026-03-10)


### Features

* **score:** restore score on startup and compare best ([9aadba3](https://github.com/glorynguyen/ollama-code-review/commit/9aadba3f2cf2715757cab65719372773ff265efb))

# [3.29.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.28.3...v3.29.0) (2026-03-06)


### Features

* **commands:** add copy file with imports command ([052de7b](https://github.com/glorynguyen/ollama-code-review/commit/052de7ba73aba142c800ac5440258b3f99fbeaff))
* **review:** add structured review with anchor validation ([cf2838c](https://github.com/glorynguyen/ollama-code-review/commit/cf2838cb073d3fc8c87ec6d0e76f62dc1a18cff5))

## [3.28.3](https://github.com/glorynguyen/ollama-code-review/compare/v3.28.2...v3.28.3) (2026-03-03)


### Bug Fixes

* **build:** update .vscodeignore ([8b93731](https://github.com/glorynguyen/ollama-code-review/commit/8b93731cbf88e26a41f31ca802f24b4cdf4fb89c))

## [3.28.2](https://github.com/glorynguyen/ollama-code-review/compare/v3.28.1...v3.28.2) (2026-03-03)


### Bug Fixes

* **build:** add esbuild bundling ([d465373](https://github.com/glorynguyen/ollama-code-review/commit/d465373d42a0dc4a2589f8dc9892e3bc66c382fc))

## [3.28.1](https://github.com/glorynguyen/ollama-code-review/compare/v3.28.0...v3.28.1) (2026-03-03)


### Bug Fixes

* remove node_modules out of .vscodeignore ([9abe529](https://github.com/glorynguyen/ollama-code-review/commit/9abe529b817790dc2bd999b00ef39398d72bfe17))

# [3.28.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.27.0...v3.28.0) (2026-03-03)


### Features

* **review:** add copy diff button to review panel ([6c809ad](https://github.com/glorynguyen/ollama-code-review/commit/6c809ad26733ad4da214e3b1403bf4f284c996c5))

# [3.27.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.26.0...v3.27.0) (2026-03-02)


### Features

* add Quick Fix from Review Findings (F-033) ([49b405e](https://github.com/glorynguyen/ollama-code-review/commit/49b405ebdcb259ba48da0a8b8a3d192eea2648de))

# [3.26.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.25.0...v3.26.0) (2026-02-27)


### Features

* **F-032:** add Contentstack schema validation for code reviews ([b049f6e](https://github.com/glorynguyen/ollama-code-review/commit/b049f6eafeb6fc938cf3a85799fca46311f00b7c))

# [3.25.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.24.0...v3.25.0) (2026-02-27)


### Features

* **F-031:** implement Review Findings Explorer sidebar tree view ([ba39243](https://github.com/glorynguyen/ollama-code-review/commit/ba392430ff690fc5a6b60fd63746d0aca039d13b))

# [3.24.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.23.0...v3.24.0) (2026-02-27)


### Features

* **F-030:** implement Multi-Model Review Comparison ([50fcd74](https://github.com/glorynguyen/ollama-code-review/commit/50fcd7403856d1230c3254967e43756ffec84152))

# [3.23.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.22.0...v3.23.0) (2026-02-26)


### Features

* **F-029:** implement Review Annotations — inline editor decorations ([b79a98d](https://github.com/glorynguyen/ollama-code-review/commit/b79a98d15b113c823498c493e3ea0dc7596bd59e)), closes [#45](https://github.com/glorynguyen/ollama-code-review/issues/45)

# [3.22.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.21.0...v3.22.0) (2026-02-26)


### Features

* **F-028:** implement Semantic Version Bump Advisor ([9217913](https://github.com/glorynguyen/ollama-code-review/commit/92179131fd1948e7172c318d9c116b6c220ebcc6))

# [3.21.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.20.0...v3.21.0) (2026-02-26)


### Features

* **F-024:** implement Inline Edit Mode with streaming diff preview ([79b0752](https://github.com/glorynguyen/ollama-code-review/commit/79b07526c693ef4fe67f2bdd43a656130d37a614)), closes [#43](https://github.com/glorynguyen/ollama-code-review/issues/43)

# [3.20.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.19.0...v3.20.0) (2026-02-26)


### Features

* add explain file with imports command ([e1e678f](https://github.com/glorynguyen/ollama-code-review/commit/e1e678fe8005e159e5cff172a2612f072a00dc6c))

# [3.19.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.18.0...v3.19.0) (2026-02-22)


### Features

* **chat:** add [@codebase](https://github.com/codebase) context provider for RAG search ([6a4fb68](https://github.com/glorynguyen/ollama-code-review/commit/6a4fb68be1e6b458a66c95ac1e4c835720859f9b))
* **chat:** Update ci/cd ([8127062](https://github.com/glorynguyen/ollama-code-review/commit/812706297a57c4b519b2987d701da6e34ff91fc6))

# [3.18.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.17.0...v3.18.0) (2026-02-22)


### Features

* **chat:** implement @-context mentions in sidebar chat (F-023) ([d0b764f](https://github.com/glorynguyen/ollama-code-review/commit/d0b764f8838d75174669b3b0e27dcf782fa4826c))

# [3.17.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.16.0...v3.17.0) (2026-02-21)


### Features

* **reviewProvider:** add button to generate commit messages ([39ea0c8](https://github.com/glorynguyen/ollama-code-review/commit/39ea0c8d8cc732accfbb4dd521ba969ae8a75050))

# [3.16.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.15.0...v3.16.0) (2026-02-21)


### Bug Fixes

* **ci:** switch to immutable install ([6960d5c](https://github.com/glorynguyen/ollama-code-review/commit/6960d5c4674cedaf9151fdf0daf2e4cc46504f0a))
* **dependency:** update yarn lock ([34a82f0](https://github.com/glorynguyen/ollama-code-review/commit/34a82f0d16820401901d51af7b638057484c4926))
* update ko-fi button image ([100b9ef](https://github.com/glorynguyen/ollama-code-review/commit/100b9efcfc3b50a122e5ae3ec931f4562391a7b0))


### Features

* **chat:** add persistent AI review chat sidebar ([c95d812](https://github.com/glorynguyen/ollama-code-review/commit/c95d8127aba544b21afe62499e9c70dd06569267))

# [3.15.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.14.0...v3.15.0) (2026-02-21)


### Features

* implement F-022 Streaming Responses and F-026 Rules Directory (v6.0.0) ([dd276f1](https://github.com/glorynguyen/ollama-code-review/commit/dd276f161ea57cbce74ccb296ecb5dfa0a64bf44))

# [3.14.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.13.0...v3.14.0) (2026-02-20)


### Features

* implement F-009 RAG-Enhanced Reviews and F-010 CI/CD Integration (v5.0.0) ([1d6a417](https://github.com/glorynguyen/ollama-code-review/commit/1d6a4171f2046eb077ac8181cc884dacc43cbb3d))

# [3.13.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.12.0...v3.13.0) (2026-02-20)


### Features

* implement F-015 GitLab & Bitbucket integration ([c88691d](https://github.com/glorynguyen/ollama-code-review/commit/c88691d0a8a707f0baa9c91b47bd34e9d678e583))

# [3.12.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.11.0...v3.12.0) (2026-02-20)


### Features

* implement F-012 Team Knowledge Base ([2605d39](https://github.com/glorynguyen/ollama-code-review/commit/2605d393ba46125f8bef39a46cbebd1b253a784e))

# [3.11.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.10.0...v3.11.0) (2026-02-20)


### Features

* implement F-011 Review History & Analytics dashboard ([c7d9460](https://github.com/glorynguyen/ollama-code-review/commit/c7d9460379b1383f7bfe217213679631065dd3fa))

# [3.10.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.9.0...v3.10.0) (2026-02-19)


### Features

* implement F-007 (agentic multi-step reviews) and F-020 (Mermaid diagram generation) ([53bdd02](https://github.com/glorynguyen/ollama-code-review/commit/53bdd02e87ce839e810c48bb8fc5b254605d8e2a))

# [3.9.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.8.0...v3.9.0) (2026-02-19)


### Features

* implement F-016, F-018, F-019 — quality scoring, notifications, batch review ([e3011de](https://github.com/glorynguyen/ollama-code-review/commit/e3011deefea1c5d26b56cc43e48a44e514fc1248))

# [3.8.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.7.0...v3.8.0) (2026-02-19)


### Features

* F-017 — Compliance Review Profiles (OWASP, PCI-DSS, GDPR, HIPAA, SOC2, NIST CSF) ([a639221](https://github.com/glorynguyen/ollama-code-review/commit/a63922137a9dada007d9bc7ca9964cfed622293c))

# [3.7.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.6.0...v3.7.0) (2026-02-19)


### Features

* **F-008:** add multi-file contextual analysis for richer AI reviews ([660a93e](https://github.com/glorynguyen/ollama-code-review/commit/660a93ed5e11b96bbc911a94e904a511ef29b9af))

# [3.6.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.5.0...v3.6.0) (2026-02-19)


### Features

* **F-014:** add pre-commit guard for AI-reviewed commits ([6c7b7b0](https://github.com/glorynguyen/ollama-code-review/commit/6c7b7b0a98d3034e381602430d751517f5dfcb5b))

# [3.5.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.4.0...v3.5.0) (2026-02-19)


### Features

* **F-013:** add OpenAI-compatible provider support ([62d80da](https://github.com/glorynguyen/ollama-code-review/commit/62d80da150bf5dfde16c0cd1fa6c2f3acbfcf2e7))

# [3.4.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.3.0...v3.4.0) (2026-02-18)


### Features

* **F-006:** add .ollama-review.yaml project config file support ([13bbc48](https://github.com/glorynguyen/ollama-code-review/commit/13bbc48ffe44e4e91081037b0383ca9b6f66a7bd))

# [3.3.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.2.0...v3.3.0) (2026-02-18)


### Features

* **github:** add GitHub PR integration (F-004) ([65040cd](https://github.com/glorynguyen/ollama-code-review/commit/65040cd1d7818cab00369df7ecd43790bbc2ab22))

# [3.2.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.1.0...v3.2.0) (2026-02-18)


### Features

* **export:** implement F-003 Export Options for review panel ([5fd926a](https://github.com/glorynguyen/ollama-code-review/commit/5fd926a99b378fade84c6702ae19ed907f60043d))

# [3.1.0](https://github.com/glorynguyen/ollama-code-review/compare/v3.0.0...v3.1.0) (2026-02-17)


### Features

* **profiles:** implement review profiles & presets (F-001) ([7e4d4c5](https://github.com/glorynguyen/ollama-code-review/commit/7e4d4c5bdf0e05709ebd608bb0d5c6313bacad17))

# [3.0.0](https://github.com/glorynguyen/ollama-code-review/compare/v2.1.0...v3.0.0) (2026-02-13)


### Features

* **extension:** add support for MiniMax AI models ([c53d1c3](https://github.com/glorynguyen/ollama-code-review/commit/c53d1c3dfe798426e3317e8526ba6281684658db))


### BREAKING CHANGES

* **extension:** The provider type in PerformanceMetrics now includes 'minimax' as a valid value.

# [2.1.0](https://github.com/glorynguyen/ollama-code-review/compare/v2.0.0...v2.1.0) (2026-02-07)


### Features

* **prompts:** Add custom prompt templates ([e1cf00f](https://github.com/glorynguyen/ollama-code-review/commit/e1cf00f6b01c52c663c80f11e52818e26fec568f))

# [2.0.0](https://github.com/glorynguyen/ollama-code-review/compare/v1.20.0...v2.0.0) (2026-02-04)


### chore

* **mcp-server:** remove deprecated MCP server implementation ([52e71af](https://github.com/glorynguyen/ollama-code-review/commit/52e71af0f1832d7da5f6622e6c913e39c60b81bc))


### Features

* **mcp-server:** add Claude Desktop integration with 16 MCP tools ([e010771](https://github.com/glorynguyen/ollama-code-review/commit/e0107711cafc64f50e344f2028b1b57d32913aa2))


### BREAKING CHANGES

* **mcp-server:** This removes the entire MCP server functionality. Any
integrations using this server will need to be updated to use the new
implementation. The server's tools, resources, and prompts are no longer
available.

# [1.20.0](https://github.com/glorynguyen/ollama-code-review/compare/v1.19.0...v1.20.0) (2026-02-03)


### Features

* **ollama-code-review:** add multi-skill selection and clear functionality ([8d955a0](https://github.com/glorynguyen/ollama-code-review/commit/8d955a07d6bf2886891bd5756b2ef05a680ef77b))

# [1.19.0](https://github.com/glorynguyen/ollama-code-review/compare/v1.18.0...v1.19.0) (2026-02-02)


### Features

* **skills:** add support for multiple skill repositories ([e01f914](https://github.com/glorynguyen/ollama-code-review/commit/e01f914dd70c0da4434fbadfd9f7d8099d7cce13))

# [1.18.0](https://github.com/glorynguyen/ollama-code-review/compare/v1.17.0...v1.18.0) (2026-01-30)


### Features

* **code-actions:** add AI inline code actions ([f777442](https://github.com/glorynguyen/ollama-code-review/commit/f777442556c75858604123221f5af01b3b7927a0))

# [1.17.0](https://github.com/glorynguyen/ollama-code-review/compare/v1.16.0...v1.17.0) (2026-01-30)


### Features

* **codeActions:** add inline AI code actions ([82ed3ce](https://github.com/glorynguyen/ollama-code-review/commit/82ed3ce1e9123640671f64283a41b15492a541e9))

# [1.16.0](https://github.com/glorynguyen/ollama-code-review/compare/v1.15.0...v1.16.0) (2026-01-30)


### Features

* add Mistral AI support ([93234be](https://github.com/glorynguyen/ollama-code-review/commit/93234be0ff55700a53e574ab6d6b85f4e7a37eae))

# [1.15.0](https://github.com/glorynguyen/ollama-code-review/compare/v1.14.0...v1.15.0) (2026-01-30)


### Features

* add performance metrics and HF model picker ([e5deee2](https://github.com/glorynguyen/ollama-code-review/commit/e5deee24de622e4fb4b1c42c019d4b48be31bc5a))

# [1.14.0](https://github.com/glorynguyen/ollama-code-review/compare/v1.13.0...v1.14.0) (2026-01-29)


### Features

* add Gemini (Google AI) support ([4091053](https://github.com/glorynguyen/ollama-code-review/commit/4091053d44f3b2cb452bb876510b6a83ee0a5239))

# [1.13.0](https://github.com/glorynguyen/ollama-code-review/compare/v1.12.0...v1.13.0) (2026-01-29)


### Features

* **api:** add Hugging Face Inference API support ([da22de6](https://github.com/glorynguyen/ollama-code-review/commit/da22de681c8c4f1205d805c1d74f6ebc0b549744))

# [1.12.0](https://github.com/glorynguyen/ollama-code-review/compare/v1.11.0...v1.12.0) (2026-01-29)


### Features

* add GLM model support via Z.AI API ([1a8ead0](https://github.com/glorynguyen/ollama-code-review/commit/1a8ead08b7a79650d5e10704f92feebdc8d82d8d))

# [1.11.0](https://github.com/glorynguyen/ollama-code-review/compare/v1.10.0...v1.11.0) (2026-01-29)


### Features

* implement smart diff filtering ([78756b6](https://github.com/glorynguyen/ollama-code-review/commit/78756b6533627b6c17f95f6752630b7536960e2c))

# [1.10.0](https://github.com/glorynguyen/ollama-code-review/compare/v1.9.0...v1.10.0) (2026-01-29)


### Features

* **claude:** Add Claude model support ([15c32d8](https://github.com/glorynguyen/ollama-code-review/commit/15c32d85a2722e42139f6666c1fcfc42891c0b47))

# [1.9.0](https://github.com/glorynguyen/[secure]-code-review/compare/v1.8.0...v1.9.0) (2026-01-29)


### Features

* release version 1.8.0 ([deada67](https://github.com/glorynguyen/[secure]-code-review/commit/deada679fa4a06159247b47faa0ada13b1bc0fbe))

# [1.7.0](https://github.com/glorynguyen/ollama-code-review/compare/v1.6.0...v1.7.0) (2026-01-29)


### Features

* **extension:** Add model selector and set kimi-k2.5 as default ([bfd2436](https://github.com/glorynguyen/ollama-code-review/commit/bfd24362d70021743b5a80421a0c24276531002d))
* **review:** add interactive chat for follow-up questions ([8f392c7](https://github.com/glorynguyen/ollama-code-review/commit/8f392c74f7ec7bf44cc9acdb14b506ea412b8a7d))

# [1.7.0](https://github.com/glorynguyen/ollama-code-review/compare/v1.6.0...v1.7.0) (2026-01-28)


### Features

* **review:** add interactive chat for follow-up questions ([8f392c7](https://github.com/glorynguyen/ollama-code-review/commit/8f392c74f7ec7bf44cc9acdb14b506ea412b8a7d))


### Features

* **extension:** Add model selector and set kimi-k2.5 as default ([bcbfe1a](https://github.com/glorynguyen/ollama-code-review/commit/bcbfe1a352be55d20d955bf64cb066a7d4b6e72b))
* **review:** add interactive chat for follow-up questions ([8f392c7](https://github.com/glorynguyen/ollama-code-review/commit/8f392c74f7ec7bf44cc9acdb14b506ea412b8a7d))

# [1.6.0](https://github.com/glorynguyen/ollama-code-review/compare/v1.5.1...v1.6.0) (2026-01-25)


### Features

* **ci:** add semantic-release workflow for automated publishing ([d33cafc](https://github.com/glorynguyen/ollama-code-review/commit/d33cafc402f5de3e66a924c52a565a067ac324a5))
* **extension:** add agent skills and commit review features ([954193d](https://github.com/glorynguyen/ollama-code-review/commit/954193dc963e8469c6ceb4bb83ad4d058900ac33))

# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [1.5.1](https://github.com/glorynguyen/ollama-code-review/compare/v1.5.0...v1.5.1) (2026-01-23)

## [1.5.0](https://github.com/glorynguyen/ollama-code-review/compare/v1.4.0...v1.5.0) (2026-01-23)


### Features

* **src/reviewProvider.ts:** Add OllamaReviewPanel for displaying code reviews in a webview ([5c4dfb5](https://github.com/glorynguyen/ollama-code-review/commit/5c4dfb5e3b6c1f0f278ab61eb8f701af0919643b))

## 1.4.0 (2025-09-16)


### Features

* Add animated GIF to README and enhance suggestion feature ([2a2a33e](https://github.com/glorynguyen/ollama-code-review/commit/2a2a33ece529929f1a847d7196d8d9684963bf0f))
* Add code refactoring suggestion feature ([8f34e49](https://github.com/glorynguyen/ollama-code-review/commit/8f34e49a1e7478e948da93ae16fa182492069ce8))
* **config:** add frameworks configuration ([71dfac6](https://github.com/glorynguyen/ollama-code-review/commit/71dfac60137eed014dccf26eabe222715594f13d))
* **package.json:** Add PHP support for code review suggestions ([12da335](https://github.com/glorynguyen/ollama-code-review/commit/12da335e75abcc25ce2fa548f4c279fe46ffe75b))
* **README.md:** Add new feature for suggesting code improvements ([51c7079](https://github.com/glorynguyen/ollama-code-review/commit/51c70790979d485f6fcd5501685f95d6122d8a66))


### Bug Fixes

* **extension:** resolve multi-repo workspace issues ([0b725e3](https://github.com/glorynguyen/ollama-code-review/commit/0b725e3eed20b8175db5da99fe57337e92e69d01))

## 1.3.0 (2025-09-16)


### Features

* Add animated GIF to README and enhance suggestion feature ([2a2a33e](https://github.com/glorynguyen/ollama-code-review/commit/2a2a33ece529929f1a847d7196d8d9684963bf0f))
* Add code refactoring suggestion feature ([8f34e49](https://github.com/glorynguyen/ollama-code-review/commit/8f34e49a1e7478e948da93ae16fa182492069ce8))
* **config:** add frameworks configuration ([71dfac6](https://github.com/glorynguyen/ollama-code-review/commit/71dfac60137eed014dccf26eabe222715594f13d))
* **package.json:** Add PHP support for code review suggestions ([12da335](https://github.com/glorynguyen/ollama-code-review/commit/12da335e75abcc25ce2fa548f4c279fe46ffe75b))
* **README.md:** Add new feature for suggesting code improvements ([51c7079](https://github.com/glorynguyen/ollama-code-review/commit/51c70790979d485f6fcd5501685f95d6122d8a66))


### Bug Fixes

* **extension:** resolve multi-repo workspace issues ([0b725e3](https://github.com/glorynguyen/ollama-code-review/commit/0b725e3eed20b8175db5da99fe57337e92e69d01))

## [1.2.3] - 2025-09-16
### Added
- Code refactoring suggestion feature.

---

## [1.2.2] - 2025-09-13
### Added
- PHP support for Ollama Suggestion.

---

## [1.2.1] - 2025-08-24
### Fixed
- Resolve multi-repo workspace issues.

---

## [1.2.0] - 2025-08-22
### Added
- Frameworks configuration.

---

## [1.1.1] - 2025-08-22
### Added
- Animated GIF in README.  
- Enhanced suggestion feature.

---

## [1.1.0] - 2025-08-20
### Added
- New feature for suggesting code improvements.

---

## [1.0.2] - 2025-08-12
### Added
- Generate commit message feature.  
- Temperature configuration for Ollama model.  
- Verification command for Ollama setup.  
- Output panel image.  

### Changed
- Updated README with usage instructions and commands image.  
- Updated logo.  

---

## [1.0.1] - 2025-08-12
### Changed
- Updated prompt in `extension.ts` for code review functionality.  
- Updated package version.  

---

## [1.0.0] - 2025-08-12
### Added
- LICENSE file.  
- Author and license fields in `package.json`.  
- Command to review commit changes in Ollama Code Review extension.  
- Project configuration files.  
- Initial README.  

### Changed
- Updated `package.json` scripts.  
- Updated lint command.  
- Updated README and activation events.  
- Refined prompt for code review.  
- Cleaned up unused comments and refactored code for clarity.  

---

## [0.1.0] - 2025-08-11
### Added
- Initial release.  
- Base project configuration files.  
- Initial command structure for Ollama Code Review extension.
