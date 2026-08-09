# One-time GitHub Pages activation

The RiverForge browser app and deployment workflow are already on `main`.

GitHub requires the repository owner to activate Pages once before the normal workflow token can deploy the site:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Open **Actions → Deploy GitHub Pages** and choose **Run workflow**.

After this setting is enabled, pushes to `main` automatically test, build, and deploy the hosted solver at:

<https://edwin-hou.github.io/coding-project/>
