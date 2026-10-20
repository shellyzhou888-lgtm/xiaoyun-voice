"""Trusted SQLite/search worker. Dynamic SQL is run only on a read-only connection."""
import json
import sqlite3
import sys
import time
from pathlib import Path


def seed(db_path):
    db = sqlite3.connect(db_path)
    db.execute('CREATE TABLE IF NOT EXISTS sales (region TEXT, year INTEGER, month INTEGER, product TEXT, revenue REAL, cost REAL, PRIMARY KEY(region, year, month, product))')
    if not db.execute('SELECT COUNT(*) FROM sales').fetchone()[0]:
        rows = []
        for ri, region in enumerate(['华东', '华南', '华北', '西部']):
            for year in [2025, 2026]:
                for month in range(1, 13):
                    for pi, product in enumerate(['云服务', '数据产品', '企业方案']):
                        revenue = round((210000 - ri * 23000 + pi * 18500) * (1 + month * .045) * (1 + (year - 2025) * [.18, .11, -.04, .075][ri]), 2)
                        ratio = [.64, .67, .73, .70][ri] + (year - 2025) * [.025, -.018, .045, .005][ri]
                        rows.append((region, year, month, product, revenue, round(revenue * ratio, 2)))
        db.executemany('INSERT INTO sales VALUES (?,?,?,?,?,?)', rows)
    db.commit()
    db.close()


def readonly_query(db_path, sql, params=None, limit=10000):
    uri = Path(db_path).resolve().as_uri() + '?mode=ro'
    db = sqlite3.connect(uri, uri=True)
    db.row_factory = sqlite3.Row
    def authorize(action, arg1, arg2, _db, _source):
        if action in (sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_RECURSIVE):
            return sqlite3.SQLITE_OK
        if action == sqlite3.SQLITE_FUNCTION and (arg2 or '').lower() not in ('load_extension', 'writefile', 'readfile'):
            return sqlite3.SQLITE_OK
        if action == sqlite3.SQLITE_PRAGMA and arg1.lower() in ('table_info', 'table_xinfo'):
            return sqlite3.SQLITE_OK
        return sqlite3.SQLITE_DENY
    db.set_authorizer(authorize)
    deadline = time.monotonic() + 8
    db.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
    try:
        cursor = db.execute(sql, params or [])
        rows = [dict(row) for row in cursor.fetchmany(limit + 1)]
        return {'rows': rows[:limit], 'truncated': len(rows) > limit, 'columns': [d[0] for d in cursor.description or []]}
    finally:
        db.close()


def run(req):
    command = req['command']
    if command == 'init':
        Path(req['dataDir']).mkdir(parents=True, exist_ok=True)
        if req.get('seedDemo', True):
            seed(req['salesPath'])
        with sqlite3.connect(req['statePath']) as db:
            db.execute('CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, project TEXT, client TEXT, payload TEXT, updated INTEGER)')
            for task_id, raw in db.execute('SELECT id,payload FROM tasks').fetchall():
                item = json.loads(raw)
                changed = False
                if item['info']['status'] in ('queued', 'running'):
                    item['info']['status'] = 'interrupted'
                    item['info']['progress'] = '后台重新启动，任务已中断，可重新提出要求。'
                    if not item.get('result'):
                        info = item['info']
                        item['result'] = {'taskId': info['taskId'], 'sessionId': info['sessionId'], 'projectId': item['projectId'], 'status': 'interrupted', 'title': info['title'], 'summary': '后台重新启动，这个任务已中断。可以点击重试任务。', 'contextAtStart': info['contextAtStart'], 'requestOrder': info['requestOrder']}
                    changed = True
                delivery = item.get('delivery')
                if delivery and delivery['status'] in ('queued', 'generating', 'playing'):
                    delivery.update(status='interrupted', reason='后台重启，可手动重播。', updatedAt=int(time.time() * 1000))
                    changed = True
                if changed:
                    db.execute('UPDATE tasks SET payload=? WHERE id=?', (json.dumps(item, ensure_ascii=False), task_id))
        return {'ready': True}
    if command == 'query':
        return readonly_query(req['path'], req['sql'], req.get('params'), req.get('limit', 10000))
    if command == 'save':
        item = req['task']
        with sqlite3.connect(req['path'], timeout=10) as db:
            db.execute('INSERT INTO tasks VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated=excluded.updated', (item['info']['taskId'], item['projectId'], item['clientId'], json.dumps(item, ensure_ascii=False), item['info']['updatedAt']))
        return {'saved': True}
    if command == 'load':
        with sqlite3.connect(req['path']) as db:
            return [json.loads(row[0]) for row in db.execute('SELECT payload FROM tasks WHERE project=? AND client=? ORDER BY updated', (req['projectId'], req['clientId']))]
    if command == 'search':
        from ddgs import DDGS
        return list(DDGS(timeout=12).text(req['query'], max_results=5))
    raise ValueError('Unknown worker command')


if __name__ == '__main__':
    try:
        print(json.dumps({'ok': True, 'result': run(json.load(sys.stdin))}, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False))
        sys.exit(1)
