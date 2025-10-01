# Breakroom

- clone the repo
- navigate to the directory
- copy example.breakroom.env to breakroom.env
- add your API key and desired Site ID to breakroom.env
- from the directory:

```shell
docker-compose up --build -d
```

**This requires that a door is setup as an in/out door in Verkada Command and configured for Anti-passback if you want violations flagged.**
