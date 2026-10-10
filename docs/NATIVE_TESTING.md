# Native Windows verification

The native smoke test launches the actual release executable and controls its WebView2 through Playwright CDP. It creates three disposable fixture projects, invokes a real Rust scan from the UI, verifies discovered projects and finding sizes, exercises personal protection and compares file hashes and modification timestamps before/after scanning. Screenshots and a JSON result are retained as evidence. No test-only scan implementation or mocked native response is used.

## Normal-user execution on CI

WebView2 Runtime 150 and newer ignore the environment-supplied remote debugging flag when the host is elevated. GitHub Windows runners normally run elevated. This caused the initial test to time out despite the release application starting and displaying its interface correctly.

`scripts/windows-native-test.ps1` runs the test at Medium integrity on the disposable Windows runner, following the upstream workaround. Its portable gsudo 2.6.1 helper is downloaded from the official GitHub release into the runner's temporary directory and checked against the published SHA-256 before extraction. It grants checkout access only to the current runner account. The unchanged release application receives its test-only debugging environment and uses a disposable WebView profile. The test helper is not an application dependency and is not installed by the product installer.

The delivered application does not enable a debugging port in its code or configuration. A configured native check must actually pass before native scan interaction is claimed as verified. The diagnostic workflow can test an existing, non-expired Windows artifact without rebuilding it; supply that workflow run's ID when starting the diagnostic workflow manually.

Sources:
- https://github.com/tauri-apps/wry/issues/1782
- https://github.com/MicrosoftEdge/WebView2Feedback/issues/5645
- https://playwright.dev/docs/webview2
- https://github.com/gerardog/gsudo

## Not covered by the smoke test

Native folder/save-dialog interaction, the file-manager reveal action, installation/uninstallation, large-workspace cancellation and performance on a real multi-year development workspace still require separate validation. Passing the smoke test is not a security audit or a claim that every possible cache location is detected.
