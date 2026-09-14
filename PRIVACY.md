# Privacy and Data Handling

Last updated: September 2026

Zhuyan AI is a local-first desktop application. This document describes the behavior of the source release in this repository. A third-party build or modified distribution may behave differently.

## Data stored on your device

Zhuyan AI stores the following data under Electron's per-user `userData` directory:

- provider settings, including the API base URL and model identifiers;
- an API key encrypted with Electron `safeStorage` and the current operating-system user credentials;
- room photographs copied into user-created projects;
- generated design versions, version metadata and furnishing lists;
- local tool-run records used for project recovery and troubleshooting.

The application does not include an in-app permanent project deletion feature in this release. Archiving a project does not delete its files. Uninstalling the application is configured to preserve application data.

## Data sent over the network

Zhuyan AI does not operate a hosted AI service. When you configure an OpenAI-compatible provider and explicitly start an operation, the desktop application sends data directly from your device to that provider:

- connection testing sends a request to the provider's `/models` endpoint;
- reference-image analysis sends the selected reference image and analysis instructions to `/chat/completions`;
- furnishing-list analysis sends the relevant project images and analysis instructions to `/chat/completions`;
- image generation or revision sends the source image, any separately authorized visual reference and generation instructions to `/images/edits`;
- a returned image URL may be downloaded from the provider response.

Your provider's terms, retention policy, location, security practices and charges apply to those requests. Use a trusted HTTPS provider. An HTTP provider transmits API credentials, images and request content without transport encryption.

Marketplace search buttons open fixed HTTPS search pages for supported third-party marketplaces in your default browser. Search keywords are included in the destination URL. Zhuyan AI does not access your marketplace account, prices, orders or payment information.

## Telemetry and analytics

The source release does not include product analytics, advertising trackers, crash-reporting services or a Zhuyan AI telemetry server. Normal network requests made to your configured AI provider, GitHub, package registries or marketplace websites are governed by those third parties.

## Reference-image rights

Only upload images that you own or are authorized to analyze and use for generation. Reference-image analysis and image generation are separate actions. A reference image is not copied into the project by default, but it is transmitted to the configured provider when you authorize an applicable AI operation.

## Clearing local data

- Use **Settings → Clear Provider Settings** to remove the saved provider configuration and encrypted API key. This does not remove projects or generated images.
- To remove all local projects and application data, fully quit Zhuyan AI and delete its per-user `userData` directory. The exact location is platform-specific and is the directory returned by Electron `app.getPath("userData")`.
- Removing local files does not remove data already sent to an AI provider, marketplace, backup system or synchronization service. Contact the applicable third party and review its policy for those copies.

Back up any design versions you want to keep before deleting local application data.

## Security limitations

Encryption with `safeStorage` protects the saved API key using operating-system facilities, but it does not protect against a compromised user account, malware, an untrusted provider or an unencrypted HTTP connection. See [SECURITY.md](SECURITY.md) for reporting security issues.
