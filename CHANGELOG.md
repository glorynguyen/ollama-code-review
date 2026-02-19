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
