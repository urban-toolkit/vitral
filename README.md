<div align="center">
  <img src="logo.png?raw=true" alt="Vitral Logo" height="250"/></br>
</div>

### Running

1) Cloning the repo: https://github.com/urban-toolkit/vitral

2) Creating a .env on the root with OPENAI_API_KEY=xxxx (each request consumes ~$0.02)

3) Executing: docker-compose --file docker-compose.dev.yml up --watch

4) And dragging any txt file into the canvas.

To recreate database:

docker-compose --file docker-compose.dev.yml down

