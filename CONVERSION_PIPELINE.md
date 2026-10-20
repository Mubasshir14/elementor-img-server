# Screenshot conversion fixes and verification

Date: October 20, 2026 (Asia/Dhaka).

## Verified failures and implemented changes

| Verified failure | Change and regression evidence |
| --- | --- |
| Storage failures were caught and vision continued with text only. Source metadata was trusted over decoded content. | `loadSourceImage` now requires a source, bounds retrieval time, fully decodes supported image content, checks the upload SHA-256 and stored dimensions, and downloads the original once. The orchestrator always attaches image bytes. Retrieval, invalid bytes, integrity, timeouts and successful attachment are tested. |
| `executeDIRStage` changed configured Gemini 3.8 to Flash-Lite. Gemini retries could also select a sibling model; router availability could be fabricated with a placeholder key or missing adapters could resolve to mock. | The validated environment resolves the vision provider and model in the router. `VISION_AI_MODEL`, when nonempty, overrides that provider's model; otherwise the provider model applies. The Gemini adapter honors constructor options and request overrides, rejects malformed identifiers, and retries transient errors on the same model. Vision errors do not trigger a provider/model substitution. Missing credentials/providers and text-only vision requests fail clearly. |
| Frontend accepted WebP; intake middleware and image utility rejected it. The upload route persisted the claimed MIME. | PNG, JPEG and static WebP are accepted throughout intake, storage and provider input. Both validators use the same content validation; MIME and dimensions come from decoded bytes. Animated/multipage images are rejected. HTTP integration tests cover all three formats. |
| Analysis-copy and tile helpers existed but were absent from conversion. | The live orchestrator uses lossless PNG analysis copies up to 1920px wide and overlapping 2400px vertical tiles, with 400px overlap, when height exceeds both 3000px and 2.5 times width. Analysis dimensions, original dimensions and offsets are retained. Results are analyzed independently, transformed to original pixels, geometrically reconciled and schema validated. IDs and image/background references are namespaced and repeated assets reconciled. Missing geometric evidence for tiled sections fails explicitly. |
| Failed cropping was replaced by fabricated SVGs; the compiler could substitute an unrelated first asset. | Referenced assets must resolve to a validated original-image crop or decodable explicit image URL/data URI. Storage/crop failures propagate. Every asset reference, including background and gallery references in the tree, resolves through the same extraction pass. Missing assets never become fabricated SVGs. |
| DIR did not admit node/section bounds or explicit uncertainty. Some prompt examples used invalid responsive direction keys and recommended invented placeholder text. | Existing image-box, testimonial, gallery and toggle branches now have matching TypeScript/Zod contracts. Gallery and toggle are also registered in the runtime Core widget registry; their bundled reference files were previously insufficient to register them at runtime. Optional original-pixel `sourceRect`, `observedProperties`, `inferredProperties`, and `uncertainty` are admitted on nodes/sections. Numeric dimensions mean pixels; percentages are strings. Prompt constraints specify local analysis coordinates, strict transcription and `flexDirection` overrides. Measured headers keep their hierarchy rather than receiving a guessed three-slot normalization. |
| Compiler changed measured widths to 50% or 52/48, clamped heights/logos, invented responsive rules and mutated input. IDs were random. | Compiler clones its input, uses deterministic unique IDs, preserves numeric pixel and percentage dimensions and large heights, retains explicit column widths, and emits only explicit tablet/mobile overrides. A source-node-to-element map supports local correspondence checks. Single-page compilation is enforced instead of silently dropping extra pages. |
| Settings included `image_fit` and `button_padding`, which are not the source control names. Widget spacing was missing or used container keys. | Image fit uses `object-fit`; image radius uses `image_border_radius`; button interior padding uses `text_padding`; widget advanced spacing uses `_margin` and `_padding`. Media IDs remain empty until WordPress assigns an attachment ID. These controls were checked against the bundled source index and official Elementor source. |
| Invalid Elementor validation was logged and still reached `preview_ready`. Quality checks let any heading or row satisfy an unrelated node. | Schema failure is fatal before saving a final artifact. Per-node checks enforce hierarchy, direction and correct images, and issue individual typography warnings. Compiler and validator warnings are persisted. Failed jobs clear old artifacts, persist a failed stage and remain failed. |
| Upload/retry routes dispatched conversion directly while the worker independently claimed jobs. | Upload only enqueues; the worker owns execution. Retry rejects active jobs, clears stale artifacts and returns the updated job. This removes the second execution path. |
| UI treated preview-ready as a rendered preview, hid validation warnings, and could not associate its source image reliably. | UI reports JSON readiness with visual fidelity unmeasured, displays warnings, marks unperformed rendering explicitly, shows upload byte progress, validates response/job associations and redirects to the returned project. A new authenticated job-source endpoint returns the original associated screenshot. No hardcoded storage host is required. |

## Current production flow

`client upload -> POST /api/v1/upload -> content validation and original storage -> queued job -> worker atomic claim -> validated original retrieval/hash check -> analysis copy/tiles -> image-attached vision requests -> bounded DIR normalization/repair and schema validation -> original-coordinate merge -> referenced asset extraction -> deterministic compiler -> Elementor structural validation and per-node correspondence -> artifact storage -> preview_ready JSON inspection`.

The original buffer remains the source for dimensions and asset cropping. Analysis copies never replace it. Temporary/signed URLs are unnecessary for production vision delivery: stored bytes are attached inline. The Gemini URL/file adapter path also validates actual content, handles retrieval deadlines and avoids including signed URLs in retrieval errors.

`validateImage`, `createAnalysisCopy`, `createTiles`, `cropAsset` and `computeContentHash` now participate in live conversion. `checkMagicBytes` is called by `validateImage`. `getImageMetadata` and `createThumbnail` remain exported helpers without live conversion callers. `validateImageBuffer` / `validateUploadedImage` remain alternative middleware exports; the live upload route uses `validateImage` directly. Both validation paths share the same policy.

## Deployment and compatibility

No new dependency or database migration is required. Existing valid credentials remain compatible. Keep the operative skill and bundled source/reference files in deployments alongside the application, as required by the existing serializer.

- Run the API and the worker. Uploads now remain queued until the worker is running. Use `npm run worker` for the existing development worker command; production deployments should run the compiled worker (`node dist/worker.js`) as a separate process alongside the API.
- Configure `VISION_AI_PROVIDER` and the corresponding real credential. For Gemini, set `GEMINI_API_KEY`, keep `ENABLE_GEMINI=true`, and set `GEMINI_MODEL=gemini-3.8-flash` (the documented/default identifier). A nonempty `VISION_AI_MODEL` takes precedence. Clear it to inherit the provider model. Existing explicit values are honored exactly; access to a model is still determined by the provider API.
- `AI_REQUEST_TIMEOUT_MS` continues to bound source/remote retrieval and provider request timing. Gemini's existing bounded transient retry remains on the same model.
- The existing defaults for structure/review providers remain. A structural repair provider needs its configured credential if a DIR requires AI repair.
- Supported uploads: PNG, JPEG, static WebP; existing upload byte and 100-megapixel limits remain. Corrupt pixels and animation are rejected.
- Responsive output deliberately changes: no automatic stacking or font/spacing shrinkage is invented. Supply `responsiveOverrides` for known tablet/mobile behavior. `gridColumns` is available in responsive styles.
- Regenerate older jobs to get these gates; this change does not retroactively certify persisted artifacts.

## Test commands and actual results

All new tests use local synthetic image pixels and mocked providers/storage/database or local HTTP servers. No new test requires paid AI access, a real WordPress site, or API credentials.

| Repository | Command | Result |
| --- | --- | --- |
| Server | `npm test -- --reporter=dot` | 288 tests passed in 29 files. |
| Server | `npm run typecheck` | Passed. |
| Server | `npm run build` | Passed. |
| Server | `npm run lint` | Fails: 37 existing errors and 363 warnings at the recorded run. Untouched `HEAD` has 40 errors / 363 warnings; ESLint comparison by file/rule/message found **no new errors**. Existing failures include unused imports/variables, namespace rules and publisher lint issues. No lint rules were disabled. |
| Client | `npm test -- --reporter=dot` | 21 tests passed in 4 files. |
| Client | `npm run typecheck` | Passed. |
| Client | `npm run lint` | Passed with 3 warnings: existing polling-hook dependencies and two `img` optimization warnings. |
| Client | `npm run build` | Passed; Next.js generated 8 routes. |
| Both | `git diff --check` | Passed. |

New regression suites:

- `server/src/__tests__/pipeline-regression.test.ts`: supported formats, actual provider attachment, corrupt/spoofed images, failed/expired HTTP retrieval, timeouts, image identity, model option precedence, tall-image preprocessing, coordinate scale/offset, overlap reconciliation and asset aliases; seven layout cases, deterministic IDs/no caller mutation, explicit responsive settings and node-specific warnings.
- `server/src/__tests__/orchestrator-regression.test.ts`: real production orchestration with mocked dependencies; image absence/failure, provider and schema errors, both truncation reasons, invalid Elementor rejection, original crop pixels, source metadata and truthful readiness/status.
- `server/src/__tests__/http-pipeline-contract.test.ts`: multipart PNG/JPEG/WebP uploads, actual response/source/job agreement, invalid image rejection, source-image authorization and active-job retry rejection.
- `client/src/__tests__/api-contract.test.ts`: multipart field names, WebP policy, source/job association, malformed/unsuccessful responses and actionable errors.
- `client/src/__tests__/stage-status.test.tsx`: unperformed rendering and failed active stages.

Existing tests retain their hierarchy/content checks. Assertions for fabricated image fallback, random media attachment IDs, forced height clamps and automatic responsive reflow were updated to the new contract. Compiler-only fixtures now explicitly provide media URLs instead of depending on production fabrication.

## What remains unverified

Structural validity is separate from visual fidelity. The persisted audit explicitly reports `visualFidelity.status = not_measured`. No similarity score, successful render, viewport emulation, or live WordPress import is claimed.

This workspace has a WordPress publishing plugin and mock MCP publishing tests, but no runnable WordPress/Elementor installation, browser screenshot evaluator, Docker executable, or PHP executable was available. No production site was published to or changed. The JSON inspector is not an Elementor renderer.

Real screenshots still require evaluation of model perception, OCR transcription, font availability, exact measurements, tile-boundary fragments, asset quality, and renderer-dependent controls. Overlap reconciliation is geometric and semantic, so ambiguous detections can still require correction. The system now fails explicit missing-evidence cases and exposes uncertainty; that does not establish visual similarity.

For live evaluation, use an isolated WordPress site with the supported Elementor version and matching fonts. Import the compiled JSON, render it at the original image dimensions, capture it with a browser, and compare per-node boxes, transcription, image placement, colors/typography and perceptual similarity together. Diagnose mismatches before any bounded correction. Until that environment exists, render-and-compare and real-image fidelity remain outstanding verification work.

The legacy compiler still has specialized widget handling; not every complex vector, effect, map, video, or interactive component can be inferred from one raster screenshot. Do not interpret the passing common-layout tests as certification of every widget or every screenshot.

## Sources checked

- [Google Gemini model catalog](https://ai.google.dev/gemini-api/docs/models): configured model identifier verification.
- [Gemini image input](https://ai.google.dev/gemini-api/docs/image-understanding): inline image delivery and MIME structure.
- [Elementor data structure](https://developers.elementor.com/docs/data-structure/general-elements.html): nested containers/widgets, settings and child element arrays.
- [Elementor Image source](https://github.com/elementor/elementor/blob/main/includes/widgets/image.php): `object-fit`, image radius and sizing controls, also corroborated by the bundled source index.
- [Elementor Button trait](https://github.com/elementor/elementor/blob/main/includes/widgets/traits/button-trait.php): `text_padding`.

## Exact files changed

Paths below are relative to each repository. Check logs are ignored local artifacts and are not part of the source changes.

### server

- `.env.example`
- `CONVERSION_PIPELINE.md`
- `README.md`
- `src/__fixtures__/responsive-fixtures.ts`
- `src/__fixtures__/sample-dir.json`
- `src/__tests__/elementor-generation.test.ts`
- `src/__tests__/four-stage-fidelity-pipeline.test.ts`
- `src/__tests__/gemini-fallback-and-cache.test.ts`
- `src/__tests__/gemini-model-resolution.test.ts`
- `src/__tests__/gym-landing-reconciliation.test.ts`
- `src/__tests__/http-pipeline-contract.test.ts`
- `src/__tests__/navbar-structure.test.ts`
- `src/__tests__/orchestrator-regression.test.ts`
- `src/__tests__/pipeline-regression.test.ts`
- `src/__tests__/responsive-pipeline.test.ts`
- `src/__tests__/visual-fidelity.test.ts`
- `src/config/env.ts`
- `src/middleware/upload.ts`
- `src/modules/ai/fixtures/dir.json`
- `src/modules/ai/fixtures/vision.json`
- `src/modules/ai/providers/gemini.ts`
- `src/modules/ai/router.ts`
- `src/modules/conversion/orchestrator.ts`
- `src/modules/conversion/preprocessing.ts`
- `src/modules/conversion/prompts.ts`
- `src/modules/conversion/structural-audit.ts`
- `src/modules/dir/normalizer.ts`
- `src/modules/dir/schema.ts`
- `src/modules/dir/types.ts`
- `src/modules/elementor/generator.ts`
- `src/modules/elementor/registry.ts`
- `src/modules/elementor/types.ts`
- `src/modules/elementor/validator.ts`
- `src/modules/storage/image-input.ts`
- `src/modules/storage/image-processor.ts`
- `src/modules/storage/storage.test.ts`
- `src/modules/storage/types.ts`
- `src/routes/jobs.ts`
- `src/routes/projects.ts`
- `src/routes/upload.ts`

### client

- `README.md`
- `src/__tests__/api-contract.test.ts`
- `src/__tests__/stage-status.test.tsx`
- `src/app/projects/[id]/page.tsx`
- `src/app/upload/page.tsx`
- `src/components/conversion/stage-progress.tsx`
- `src/lib/api.ts`

### Workspace documentation

- `docs/README.md`
- `.env.example`
