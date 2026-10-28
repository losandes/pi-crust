Many of my recent runs are failing at diff_matches_claims gates. For instance, run 5b997324 failed with the following output:

```
.prodcontainer/spotify-gateway/Dockerfile: claimed changed file does not exist
.prodcontainer/spotify-gateway/docker-compose.yml: claimed changed file does not exist
.prodcontainer/spotify-gateway/entry.sh: claimed changed file does not exist
.prodcontainer/spotify-gateway/Dockerfile.dockerignore: claimed changed file does not exist
.prodcontainer/spotify-gateway/README.md: claimed changed file does not exist
```

Those files _do_ exist. I think the problem may be in their relativity to the CWD. I kicked the run off from `/Users/andrewwright/src/libsyn/platform-harden-spotify/_newstack`. The files listed above are in `/Users/andrewwright/src/libsyn/platform-harden-spotify/.prodcontainer`. So they were created relative to the parent directory of the CWD. If diff_matches_claims assumes all files touched will be in the current working directory or it's children, then these gates will fail. This just won't be reliable in a mono-repo. Diagnose and fix this bug.
