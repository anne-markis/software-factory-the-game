.PHONY: graph

GRAPH_PORT ?= 5174

# Local-only authoring viewer. Override with: make graph GRAPH_PORT=5191
graph:
	npm run graph -- --host 127.0.0.1 --port $(GRAPH_PORT) --strictPort
