# Security Policy

## Supported version

Security fixes are currently evaluated for the latest source release on the `main` branch and the latest stable tag.

| Version | Supported |
| --- | --- |
| 0.10.4 | Yes |
| 0.10.3 and earlier | No |

## Reporting a vulnerability

Please do not disclose suspected vulnerabilities in a public issue, discussion, pull request or social-media post.

Use GitHub's private vulnerability reporting feature for this repository:

1. Open the repository's **Security** tab.
2. Select **Advisories**.
3. Select **Report a vulnerability**.

Include affected versions, reproduction steps, impact, relevant logs with secrets removed, and any suggested mitigation. Do not upload real API keys, user room photographs, private reference images or full project directories.

If private vulnerability reporting is unavailable, contact the repository owner privately through their GitHub profile and ask for a secure reporting channel. Do not send vulnerability details until a private channel is established.

## Security boundaries

- AI requests are sent directly to the OpenAI-compatible provider configured by the user.
- HTTPS is strongly recommended. HTTP connections expose API credentials and image content to the network path.
- Provider credentials must never be committed to the repository or included in issues and logs.
- The application uses Electron isolation controls and exposes a restricted preload API, but desktop applications still depend on operating-system, dependency and provider security.
- Internal unsigned builds are not public release binaries. Verify source, checksums and publisher identity before running third-party builds.

## Disclosure process

The maintainer will attempt to acknowledge a complete private report, investigate it, prepare a fix and coordinate disclosure. Response times are not guaranteed. A report may be closed if it does not affect this repository, requires a compromised local operating-system account, or describes expected third-party provider behavior without an application vulnerability.
