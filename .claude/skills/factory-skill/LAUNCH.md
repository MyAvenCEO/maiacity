# Launch checklist

Everything in this folder is ready to publish. Nothing has been pushed anywhere yet.

## 1. Create the repository

1. On GitHub, create a new **public** repository named `factory-skill` under the account you want
   (the README and the gallery page assume `AirsupHQ/factory-skill`; if you use another owner, run
   `grep -rl "AirsupHQ/factory-skill" . | xargs sed -i '' 's#AirsupHQ/factory-skill#OWNER/factory-skill#g'`
   and change `REPO` in `plm-app/rocket-engine/src/factoryskill/main.ts` in the airsup repo).
2. Do not add a README, licence or .gitignore on GitHub (they are here already).
3. Paste the description, website and topics from `.github/REPO.md`.
4. Settings, General, Social preview: upload `.github/assets/social.jpg`.

## 2. Push

```sh
cd "~/Documents/Airsup Main/factory-skill"
git remote add origin https://github.com/AirsupHQ/factory-skill.git
git push -u origin main
```

## 3. Check

- The README renders with the hero GIF and the six gallery stills.
- `npx skills add AirsupHQ/factory-skill -g -a claude-code` installs it (needs Node 22.20 or later for
  the skills CLI); then `/factory a bakery that bakes 10,000 croissants an hour` in Claude Code.
- `git clone https://github.com/AirsupHQ/factory-skill.git ~/.claude/skills/factory` works too.
- Open `examples/ebike-motors/ebike-motors.html` from a fresh clone: it runs with no server.

## 4. Optional: GitHub Pages for the examples

Settings, Pages, Deploy from branch `main`, folder `/ (root)`. The examples are then live at
`https://pytro001.github.io/factory-skill/examples/ebike-motors/ebike-motors.html`. Not needed: the
gallery at airsup.ai/lab/factory-skill already hosts all six.

## 5. Optional: list it

- Submit to the skills directory used by `npx skills` (skills.sh) if you want it searchable.
- Add it to awesome lists for Claude Code skills.

## 6. Post

Film and copy: `~/Documents/New sims/35 Factory skill/` (post.md has the hook, the replies and the
link order: the GitHub link goes in reply 1, not in the main post).
