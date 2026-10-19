# eia-retrocession-web

- GitHub organization: `eia-open-insurance`
- Repository URL: https://github.com/eia-open-insurance/eia-retrocession-web
- Type: Federated front-end
- Deployable: Yes
- Owner: Retrocession
- Runtime: React 19 and Webpack 5
- Data store: None
- Depends on: eia-frontend/packages, eia-contracts, eia-platform/gateway

## Purpose

Retrocession federated remote: screens, widgets, record tabs, and transaction composition. Assumed-book retrocession contracts, retro rules, FS-RI hand-off, and recoverables.

## Implemented slice

- React 19 remote exposed as `./App` through Webpack 5 Module Federation, dev server on port `3007`.
- Async bootstrap (`index.jsx` imports `bootstrap.jsx`), shared singleton React and React DOM.
- `@swc/core` pinned to `1.10.7`.
- Workbench shows the ASSUMED book header, retro metrics, create form, retro-case table, and lifecycle actions.
- Dev server proxies `/api` to `http://localhost:8094`.
- One Playwright test with a mocked API.

## Local run

```powershell
$env:Path="C:\Program Files\nodejs;$env:Path"
npm install
npm start        # http://localhost:3007
npm run build
npx playwright test
```

## Responsibilities

- Keep this repository focused on one deployable component or one platform concern.
- Follow the repository standard in `../CONVENTIONS.md` and the specification in `../../SPEC.md`.
- Publish and consume contracts through `eia-contracts`.
- Maintain README, CODEOWNERS, SECURITY, CHANGELOG, tests, and local verification.
- Contain no business logic in shared libraries or front-end remotes.

## Verification

- Lint and format
- Unit tests with 100% business-logic coverage where applicable
- Contract tests
- Integration or Playwright tests where applicable
- Security scan and SBOM
- Build and publish

## Notes

No business logic; all actions go through the domain service.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
