# marsx

MARS-X Python package: geospatial data pipeline (`marsx.pipeline`), manifest schema (`marsx.schemas`)
and, in later modules, the conditions engine, navigation and benchmark SDK.

```
uv sync --extra pipeline            # data pipeline + tests
uv run pytest
uv run python -m marsx.pipeline build --region jezero-v1
```

Placeholder: the full SDK documentation is written with the benchmark module (T10).
