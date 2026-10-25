import asyncio
import logging

logger = logging.getLogger(__name__)


def compute(rows):
    try:
        return process(rows)
    except:
        pass


def fetch(symbol):
    try:
        return client.fetch(symbol)
    except Exception as exc:
        logger.warning("fetch failed for %s", symbol)
        return None


async def fanout(tasks):
    values = await asyncio.gather(*tasks)
    return values


async def fanout_indexed(tasks):
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return [results[0], results[1]]


def scan(cfg):
    return client.scan(cfg, createEmpty=True)
