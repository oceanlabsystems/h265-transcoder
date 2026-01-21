# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [1.6.1](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.6.0...v1.6.1) (2026-01-21)

## [1.6.0](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.5.1...v1.6.0) (2026-01-21)


### Bug Fixes

* ubuntu encoder detection, mac gstreamer bundling ([d6abed7](https://github.com/oceanlabsystems/h265-transcoder/commit/d6abed77d3434cf34244b215598ee1a3721fc0a3))

### [1.5.1](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.5.0...v1.5.1) (2026-01-21)


### Bug Fixes

* linux deps and apple vt_enc rate control syntax ([4b0b013](https://github.com/oceanlabsystems/h265-transcoder/commit/4b0b01371f0b486c50ed5831aabb804c5c6fcdd4))

## [1.5.0](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.4.13...v1.5.0) (2026-01-20)


### Bug Fixes

* cbr bitrate config in gstreamer encoders. quality encoding fallback if metadata corrupt ([db755fb](https://github.com/oceanlabsystems/h265-transcoder/commit/db755fb4843478efe8bc2c3b93c66663de2147c2))

### [1.4.13](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.4.12...v1.4.13) (2026-01-19)


### Bug Fixes

* duration detection bug and compression ratio issue on mac vtenc ([d1b977f](https://github.com/oceanlabsystems/h265-transcoder/commit/d1b977fe8a1997d38aeef7c6aa5bbf4bf60a3d12))

### [1.4.12](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.4.11...v1.4.12) (2026-01-19)


### Bug Fixes

* **gstreamer:** incorrect duration retrieval for large files ([4cfbbfd](https://github.com/oceanlabsystems/h265-transcoder/commit/4cfbbfd9976ae0a13e429270eea646a34c0007a9))

### [1.4.11](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.4.10...v1.4.11) (2026-01-18)

### [1.4.10](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.4.9...v1.4.10) (2026-01-18)


### Bug Fixes

* update apple quality mappings for more accurate results ([fdd3254](https://github.com/oceanlabsystems/h265-transcoder/commit/fdd32548de1cfd798d3306e3d353483f39a710cf))

### [1.4.9](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.4.8...v1.4.9) (2026-01-18)


### Bug Fixes

* **vtenc:** map target compression ratio to quality setting to work around apple ignorance of target bitrate ([708903b](https://github.com/oceanlabsystems/h265-transcoder/commit/708903b323b2542bf16a7a86e6f138ac3be9a845))

### [1.4.8](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.4.7...v1.4.8) (2026-01-18)


### Bug Fixes

* apple videotoolkit bitrate target ([05e25d2](https://github.com/oceanlabsystems/h265-transcoder/commit/05e25d2c33e0156e96d71b08f8348ddb4d0c1961))

### [1.4.7](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.4.6...v1.4.7) (2026-01-18)

### [1.4.6](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.4.5...v1.4.6) (2026-01-18)


### Features

* implement debug logging and debug logfile download ([177bc88](https://github.com/oceanlabsystems/h265-transcoder/commit/177bc881ea4a1e16fd4de1d7f7141f1e14b32fae))

### [1.4.5](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.4.4...v1.4.5) (2026-01-18)


### Bug Fixes

* build encoder args for each encoder separately to conform with apple videotoolbox requirements ([0e03f68](https://github.com/oceanlabsystems/h265-transcoder/commit/0e03f68ad1c01484aa73f2e3cf72a673098df942))

### [1.4.4](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.4.3...v1.4.4) (2026-01-18)


### Bug Fixes

* ask user for desired compression ratio to standardise bitrate/quality across encoders. calculate input file bitrate and target bitrate based on target ratio ([fcbc88d](https://github.com/oceanlabsystems/h265-transcoder/commit/fcbc88d391f66b6f695be0a95ef6b2117fe3bfd7))

### [1.4.3](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.4.2...v1.4.3) (2026-01-17)

### [1.4.2](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.4.1...v1.4.2) (2026-01-17)


### Features

* encoder quality tuning ([8c3198d](https://github.com/oceanlabsystems/h265-transcoder/commit/8c3198d7b02cc93989f8759bae7c182fb9169cbd))

### [1.4.1](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.4.0...v1.4.1) (2026-01-17)


### Bug Fixes

* encoder detection in production installations ([9463043](https://github.com/oceanlabsystems/h265-transcoder/commit/9463043caef9582a1723653f53b086690315b4cb))

## [1.4.0](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.3.3...v1.4.0) (2026-01-16)


### Features

* improve progress calculations by using gstreamer progress updates. auto detect encoders ([68fe0cb](https://github.com/oceanlabsystems/h265-transcoder/commit/68fe0cb001c27df4496cf71c085300e7340db70c))

### [1.3.3](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.3.2...v1.3.3) (2026-01-16)


### Features

* allow cancellation of in progress processing ([632004c](https://github.com/oceanlabsystems/h265-transcoder/commit/632004ccce92b89205a75a9be6f2979732c56df7))


### Bug Fixes

* exclude typescript files from detection ([5bd83f0](https://github.com/oceanlabsystems/h265-transcoder/commit/5bd83f071230f7797c4c4e008a83c71beb883294))
* mac and linux path passing format to gstreamer ([1d9b2ae](https://github.com/oceanlabsystems/h265-transcoder/commit/1d9b2ae3ea3f9cff5d996f28d70ad0e7e39b06ba))

### [1.3.2](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.3.1...v1.3.2) (2026-01-16)


### Bug Fixes

* codeowners ([d1dd3c2](https://github.com/oceanlabsystems/h265-transcoder/commit/d1dd3c2545b0e436d43a9b1632375c1154fe148b))

### [1.3.1](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.3.0...v1.3.1) (2026-01-16)

## [1.3.0](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.2.0...v1.3.0) (2026-01-16)

## [1.2.0](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.1.3...v1.2.0) (2026-01-16)


### Features

* CLI tool, docker, and watch mode ([3f52346](https://github.com/oceanlabsystems/h265-transcoder/commit/3f523466153306561683b0c1903d41009b3c5d74))

### [1.1.3](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.1.2...v1.1.3) (2026-01-15)

### [1.1.2](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.1.1...v1.1.2) (2026-01-15)

### [1.1.1](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.1.0...v1.1.1) (2026-01-15)

## [1.1.0](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.0.6...v1.1.0) (2026-01-15)

### [1.0.6](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.0.5...v1.0.6) (2026-01-15)

### [1.0.5](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.0.4...v1.0.5) (2026-01-15)

### [1.0.4](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.0.3...v1.0.4) (2026-01-15)

### [1.0.3](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.0.2...v1.0.3) (2026-01-15)

### [1.0.2](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.0.1...v1.0.2) (2026-01-15)

### [1.0.1](https://github.com/oceanlabsystems/h265-transcoder/compare/v1.0.0...v1.0.1) (2026-01-15)

### Bug Fixes

* remove node_modules before install to fix rollup platform binaries ([7232d94](https://github.com/oceanlabsystems/h265-transcoder/commit/7232d945a3ed60e0484ae8cb6d2a20f43fd0e2b8))

## 1.0.0 (2026-01-15)

### Features

* init application ([3a7c8bf](https://github.com/oceanlabsystems/h265-transcoder/commit/3a7c8bf54a84de990c2cb33b1ad5b3de995e114a))
