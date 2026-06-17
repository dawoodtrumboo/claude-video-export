# Contributing

Thanks for your interest in improving Claude Video Export. The rules below keep history clean and prevent accidents on the default branch.

---

## Ground rules

1. **No direct pushes to `main`.** The default branch is protected — every change lands via a pull request.
2. **No new branches in the upstream repo.** External contributors fork the repository and open PRs from their fork. Only maintainers can create branches in `claude-video-export` itself, and even maintainers PR into `main`.
3. **One PR = one logical change.** Split unrelated changes into separate PRs — easier to review, easier to revert.
4. **Keep the diff small.** A 30-line PR gets reviewed today; a 3,000-line PR sits for a week. If something needs to be big, agree on the shape in an issue first.

---

## Workflow

1. **Open an issue first** for anything beyond a small fix. A two-line problem statement saves a wasted PR.
2. **Fork the repo** and clone your fork locally.
3. **Create a feature branch** in your fork:
   ```bash
   git checkout -b fix/short-description
   ```
   Branch naming: `feat/...`, `fix/...`, `docs/...`, `chore/...`.
4. **Make the change.** Match the existing code style — no formatter is enforced; just don't reformat unrelated lines.
5. **Test locally.** At minimum, run the exporter against the `test-project/` folder and confirm an MP4 is produced. If you touched the CLI, exercise both single and `--batch` modes.
6. **Commit with a clear message.** Conventional-commits style is appreciated but not required:
   ```
   fix: hold last frame when audio outruns animation by <1 frame
   ```
7. **Open a PR against `main`.** Fill in the description: what changed, why, how you tested it. Link the issue if there is one.
8. **Address review feedback** by pushing additional commits to the same branch — don't force-push during review unless asked.

---

## What gets merged

A PR is mergeable when:

- It does what its description says, and nothing extra.
- It doesn't break the existing flows (web UI drop, single CLI, `--batch` CLI).
- It doesn't add dependencies without justification — the tool is intentionally small (two prod deps).
- A maintainer has approved it.

A PR will be sent back if:

- It includes unrelated reformatting.
- It changes the `<Stage>` contract (`window.__seek` / `window.__videoMeta` / `?__render=1`) without a corresponding migration story for existing Claude design projects.
- It adds analytics, telemetry, or network calls beyond what the local server already does.

---

## For maintainers — repo setup checklist

After creating the GitHub repo, run these once to enforce the rules above. Replace `<owner>` and `<repo>` with the real values.

### 1. Set `main` as the default branch

Done automatically when you `git push -u origin main` to a fresh repo.

### 2. Protect `main` (require PRs to merge)

Requires the `gh` CLI authenticated as a repo admin.

```bash
gh api -X PUT "repos/<owner>/<repo>/branches/main/protection" \
  -F required_pull_request_reviews[required_approving_review_count]=1 \
  -F required_pull_request_reviews[dismiss_stale_reviews]=true \
  -F enforce_admins=true \
  -F required_status_checks= \
  -F restrictions= \
  -F allow_force_pushes=false \
  -F allow_deletions=false
```

This blocks direct pushes to `main`, requires at least one PR approval, dismisses stale reviews when new commits land, applies the rule to admins too, and prevents force-pushes and branch deletion.

### 3. Restrict who can create branches in the upstream repo

By default, only users with **write** access can push branches to a public repo — outside contributors are already forced to fork. To keep it that way, simply **don't grant write access** to anyone outside the maintainer team.

If you want to additionally block maintainers from creating arbitrary branches (forcing them to fork too), add a repository ruleset:

```bash
gh api -X POST "repos/<owner>/<repo>/rulesets" \
  -f name='Restrict branch creation' \
  -f target=branch \
  -f enforcement=active \
  -f 'conditions[ref_name][include][]=refs/heads/*' \
  -f 'conditions[ref_name][exclude][]=refs/heads/main' \
  -f 'rules[][type]=creation'
```

### 4. Disable merge-commit / squash options you don't want

Open **Settings → General → Pull Requests** and pick one merge strategy (squash is recommended for a clean linear history). Disable the rest.

### 5. Add a basic `.github/CODEOWNERS` (optional)

```
*    @<your-username>
```

This auto-requests your review on every PR.

---

## Reporting bugs

Open an issue with:

- What you did (the exact CLI command, or "dropped folder X into the web UI").
- What you expected.
- What happened (paste the terminal output / browser console error).
- Your OS, Node version (`node -v`), and a minimal reproducer project if possible.

## Reporting security issues

Don't open a public issue. Email the maintainer listed in the repo's profile.
