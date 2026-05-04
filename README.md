# DupeHunter v3.0

Поиск и устранение дублей в Битрикс24.

## Запуск локально

```bash
node --version   # требуется Node.js 16+
node proxy.js    # запуск прокси
# открыть http://localhost:3000
```

## Деплой на Railway.app

1. Загрузить все файлы на GitHub
2. railway.app → New Project → Deploy from GitHub
3. Railway запустит `npm start` автоматически
4. Settings → Networking → Generate Domain
5. Проверить: `https://ваш.railway.app/health`

## Деплой на VPS

```bash
scp -r dupehunter/ user@server:/opt/dupehunter/
npm install -g pm2
cd /opt/dupehunter
pm2 start proxy.js --name dupehunter
pm2 save && pm2 startup
```

## Права вебхука

Минимальные: `crm` (полный доступ).

## Что нового в v3.0

- ✅ Rate-limit очередь (500ms между запросами к Битрикс24)
- ✅ Merge компаний: перенос ВСЕХ полей с changelog в комментарий
- ✅ Merge компаний: если поле у мастера есть — перезаписывает, если нет — заполняет
- ✅ Changelog пишется в Timeline (crm.timeline.comment.add) или в Activity как fallback
- ✅ Предупреждение о товарных позициях при merge сделок
- ✅ Ссылки на записи в Битрикс24
- ✅ Здоровье очереди в /health endpoint
