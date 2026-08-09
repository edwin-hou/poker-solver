# One-time GitHub Pages activation

The Poker Solver browser app, root fallback, tests, and deployment workflow are on `main`.

## Recommended GitHub Actions publishing

1. Rename the repository to `poker-solver` in **Settings → General → Repository name**.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Open **Actions → Deploy Poker Solver to GitHub Pages** and choose **Run workflow**.

The live URL is then:

<https://edwin-hou.github.io/poker-solver/>

## Branch publishing fallback

If Pages is already configured to deploy from `main` and `/ (root)`, the repository-level `index.html` redirects to the static application in `site/`. This avoids a 404 even without the custom deployment workflow.

After GitHub Actions publishing is enabled, every push to `main` tests, builds, and deploys the hosted solver automatically.
