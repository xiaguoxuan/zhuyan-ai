# Contributing

Thank you for your interest in Zhuyan AI.

## Before opening an issue

- Remove API keys, tokens, local paths, account identifiers and provider response headers.
- Do not upload user room photographs, private reference libraries, generated project directories or paid-provider logs.
- Use synthetic or explicitly authorized test images with metadata removed.
- Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).

## Development setup

Requirements:

- Node.js `>=22.19.0`
- npm

```powershell
cd zhuyan-ai-desktop
npm ci --ignore-scripts
npm run build
npm run prepare:packaging
```

Install the platform Electron binary only when you need to run the desktop UI:

```powershell
npm rebuild electron
npm run dev
```

## Pull requests

1. Keep the Pi runtime restricted to the documented business tools.
2. Do not move provider calls or decrypted credentials into the Renderer.
3. Preserve immutable design versions and the original room image.
4. Do not weaken capability-token, path, URL, CSP or packaging allowlists.
5. Add or update validation for security-sensitive changes.
6. Run `npm run build` and `npm run prepare:packaging` before submitting.
7. Do not include installers, build output, user data, audit inputs or reference-image bytes.

By contributing, you confirm that you have the right to submit your code and any included media under the repository license. AI-generated or third-party material must be identified and legally usable.
