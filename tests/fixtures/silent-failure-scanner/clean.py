import asyncio
import logging

logger = logging.getLogger(__name__)


def compute(rows):
    try:
        return process(rows)
    except ValueError as exc:
        logger.error("invalid rows: %s", exc)
        raise


async def fanout(tasks):
    results = await asyncio.gather(*tasks, return_exceptions=True)
    for r in results:
        if isinstance(r, Exception):
            raise r
    return results


def scan(cfg):
    return client.scan(cfg, createEmpty=False)
