# Public Release Checklist

This checklist applies before changing the GitHub repository visibility to public.

## Source and history

- [x] Current source tree contains no known API key, token, private key or local credential value.
- [x] Current source tree contains no user project, private reference library, installer or generated workspace output.
- [x] Authorized demonstration media is metadata-sanitized and covered by a separate media policy.
- [x] Software license, privacy policy, security policy, contribution guide and changelog are present.
- [x] Remove the personal email address from the initial Git commit before publication.
- [x] Re-scan every reachable Git object after the history rewrite.
- [x] Recreate and verify the stable tag after the history rewrite.

## Build and dependency validation

- [x] TypeScript typecheck passes.
- [x] Renderer and Electron builds pass.
- [x] Restricted packaging runtime validation passes.
- [x] Windows x64 unpacked application audit passes with zero private-reference hash matches.
- [x] Packaged application startup smoke test passes with isolated user data.
- [x] `npm audit` reports zero known vulnerabilities at the time of preparation.
- [x] Installed dependency license review has no GPL, AGPL, unknown or unlicensed finding.
- [x] Run the public GitHub Actions workflow after publishing the prepared source commit.

## GitHub settings

- [x] No webhook, deploy key or existing Actions workflow was present before preparation.
- [x] Validation workflow uses read-only repository permissions and pins third-party actions to full commit SHAs.
- [x] Dependabot configuration covers npm and GitHub Actions.
- [x] Enable private vulnerability reporting when supported for the public repository.
- [x] Enable GitHub secret scanning and push protection when supported.
- [x] Restrict GitHub Actions to required actions or selected actions.
- [x] Review branch protection or rulesets after the repository becomes public.

## Public binaries

The source repository may be public before public installers are available. Do not attach or advertise a production binary until all applicable items below pass:

- [ ] Production application icons.
- [ ] Trusted Windows code signing.
- [ ] Apple Developer ID signing and notarization for macOS.
- [ ] Clean Windows installation, upgrade and uninstall acceptance tests.
- [ ] Real Apple Silicon macOS build and Gatekeeper acceptance test.
- [ ] Published checksums and verified audit reports for each downloadable artifact.

## Final owner confirmation

- [x] Confirm that the authorized original room image and AI visualization may remain publicly visible; the exterior view and product-label text have been privacy-blurred.
- [x] Confirm the history rewrite and replacement of existing remote commit IDs and tag object.
- [x] Confirm changing `xiaguoxuan/zhuyan-ai` from private to public.
