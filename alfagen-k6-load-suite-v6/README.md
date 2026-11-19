# AlfaGen k6 Load Suite v6

Набор содержит **5 HTTP-скриптов и 17 Kafka producer-скриптов**. Все 15 сценариев запускаются параллельно в каждом из трёх основных режимов. Kafka-скрипты используют отдельные топики.

## Состав проекта

- `scripts/http_01_account.js` — `account`, GET, CUS.
- `scripts/http_02_currency.js` — `currency`, GET.
- `scripts/http_03_aggregate.js` — `aggregate`, POST, CUS.
- `scripts/http_04_profile_login.js` — `profile1`, GET.
- `scripts/http_05_profile_email.js` — `profile2`, GET.
- `scripts/kafka_01.js` ... `scripts/kafka_10.js` — 17 независимых Kafka producer'ов.
- `lib/profiles.js` — конфигурация трёх нагрузочных профилей и batch-режима.
- `lib/kafka.js` — единая конфигурация Kafka: brokers, SASL, SASL_PLAINTEXT, SASL_SSL, TLS, acks, timeout.
- `lib/http.js` — реестр `ENDPOINTS`, URL/body, headers и checks.
- `lib/workload.js` — сборка 22 функций в один тестовый набор.
- `scenarios/maximum.js` — ступенчатый поиск максимума.
- `scenarios/stress.js` — резкий выход на заданную нагрузку.
- `scenarios/reliability.js` — стабильная нагрузка 24 часа.
- `batch_100k.js` — отдельный пакетный запуск 100 000 сообщений на каждый из 17 Kafka-топиков.
- `run.sh`, `run.ps1` — запуск с portable k6 или k6 из PATH.

## Важное про интенсивность

Все значения rate задаются **на один скрипт**, а не на весь набор.

Например:
- `STRESS_HTTP_RATE=10` означает 10 итераций/с для каждого из 5 HTTP-скриптов, итого до 50 HTTP-запросов/с.
- `STRESS_KAFKA_RATE=10` означает 10 итераций/с для каждого из 17 Kafka-скриптов, итого до 170 Kafka-сообщений/с.

Одна итерация HTTP-скрипта выполняет один HTTP-запрос. Одна итерация Kafka-скрипта отправляет одно сообщение в топик, закреплённый за этим скриптом.

## Подготовка

```bash
cp config/.env.example config/.env
```

Заполните реальные HTTP URL, Kafka brokers, 17 топиков и учётные данные. `run.sh` автоматически загружает `config/.env`. Значения с особыми символами в пароле заключайте в кавычки.

PowerShell:
```powershell
Copy-Item config/.env.example config/.env
```

## HTTP endpoint registry

Пять операций централизованно описаны в `lib/http.js` в объекте `ENDPOINTS`. Для каждой операции заданы `method`, `requiresCus`, `buildUrl`, `headers`, необязательный `body` и `checks`. Общая функция `executeEndpoint(name)` выполняет запрос.

Переменные:
- `BASE_URL` — базовый адрес сервиса без завершающего `/`.
- `data/cus.csv` — список CUS для `account` и `aggregate` (одна колонка `cus`, по одному значению в строке). CUS выбираются по кругу между итерациями и VU.
- `HTTP_CURRENCY_RATE_DATE` — дата курса валют.
- `HTTP_OPERATION_AMOUNT`, `HTTP_EAN` — тело `aggregate`.
- `HTTP_PROFILE_LOGIN`, `HTTP_PROFILE_DOMAINS`, `HTTP_PROFILE_INCLUDE` — `profile1`.
- `HTTP_PROFILE_FNAME`, `HTTP_PROFILE_LNAME`, `HTTP_PROFILE_EMAIL` — `profile2`.

## Kafka: SASL_PLAINTEXT

Для Kafka listener без TLS, но с SASL-аутентификацией:

```dotenv
KAFKA_SECURITY_PROTOCOL=SASL_PLAINTEXT
KAFKA_SASL_MECHANISM=SCRAM-SHA-256
KAFKA_SASL_USERNAME=dev
KAFKA_SASL_PASSWORD=your-secret
```

Поддерживаемые протоколы:
- `PLAINTEXT` — без TLS и SASL.
- `SSL` — TLS без SASL.
- `SASL_PLAINTEXT` — SASL без TLS.
- `SASL_SSL` — SASL поверх TLS.

Поддерживаемые SASL-механизмы: `PLAIN`, `SCRAM-SHA-256`, `SCRAM-SHA-512`. Для `PLAINTEXT`/`SSL` укажите `KAFKA_SASL_MECHANISM=NONE`. Для TLS можно задать `KAFKA_CA_FILE`; для mTLS — оба `KAFKA_CLIENT_CERT_FILE` и `KAFKA_CLIENT_KEY_FILE`.

Старый параметр `KAFKA_TLS=true/false` сохранён как fallback, если `KAFKA_SECURITY_PROTOCOL` не задан. Явный `KAFKA_SECURITY_PROTOCOL` имеет приоритет.

Топики задаются переменными `KAFKA_TOPIC_01` ... `KAFKA_TOPIC_17`. В `.env.example` уже прописаны 17 переданных вами имён топиков. Создайте топики заранее и оставьте `KAFKA_AUTO_CREATE_TOPIC=false`.

## Kafka: топики и сообщение

Каждый скрипт `kafka_01.js` ... `kafka_17.js` отправляет одно сообщение в свой топик. Соответствие задаётся в `config/.env.example` через `KAFKA_TOPIC_01` ... `KAFKA_TOPIC_17`.

Каждый из 17 Kafka-скриптов содержит собственную JSON-структуру и локальные функции генерации параметров (`GFCUS`, `GFCOD`, `GFP3R`, `GFCTP`, `eqTimestamp`). Общего генератора нет: каждый файл можно менять независимо.

**Важно:** сейчас один шаблон сообщения используется для всех 17 топиков, как общий пример. Если у топиков разные схемы/обязательные поля, payload нужно будет разделить по семействам топиков.

## Профиль 1: maximum — ступенчатый поиск максимума

```bash
./run.sh --scenario maximum
```

Настройки:
- `MAX_HTTP_START_RATE`, `MAX_HTTP_STEP_RATE`, `MAX_HTTP_MAX_RATE`.
- `MAX_KAFKA_START_RATE`, `MAX_KAFKA_STEP_RATE`, `MAX_KAFKA_MAX_RATE`.
- `MAX_STEP_DURATION` — длительность каждой ступени.

По умолчанию: старт 1 итерация/с, шаг 5 итераций/с, максимум 25 итераций/с на каждый скрипт, 2 минуты на ступень. При этих значениях получается 5 ступеней и около 10 минут теста. HTTP и Kafka имеют независимые шкалы нагрузки.

## Профиль 2: stress — резкий выход на заданную нагрузку

```bash
./run.sh --scenario stress
```

`STRESS_HTTP_RATE` и `STRESS_KAFKA_RATE` задают целевую интенсивность сразу с начала теста на каждый соответствующий скрипт. `STRESS_DURATION` задаёт удержание (по умолчанию 10m).

## Профиль 3: reliability — 24 часа стабильной нагрузки

```bash
./run.sh --scenario reliability
```

`RELIABILITY_HTTP_RATE` и `RELIABILITY_KAFKA_RATE` задают постоянную интенсивность на один скрипт. `RELIABILITY_DURATION` по умолчанию равен `24h`.

Перед 24-часовым прогоном проверьте ресурсы генератора, место под результаты, стабильность сети, capacity/retention Kafka и сбор метрик.

## Batch: 100 000 сообщений в каждый Kafka-топик

```bash
./run.sh --scenario batch
```

Одновременно запускаются 17 Kafka-сценариев. Каждый выполняет **100 000 итераций/отправок в собственный топик**. Итого — до 1 700 000 сообщений.

Настройки:
- `BATCH_MESSAGES_PER_TOPIC=100000`
- `BATCH_KAFKA_VUS_PER_TOPIC=10`
- `BATCH_MAX_DURATION=6h`

Это отдельный пакетный режим, не смешанный с остальными профилями. При ошибках отправки число подтверждённых сообщений может быть меньше заданного; сверяйте метрики k6 и consumer-side counts.

## Запуск с portable k6

Git Bash / Linux:
```bash
K6_BIN=/path/to/k6 ./run.sh --scenario maximum
./run.sh --scenario stress --k6 ./k6-windows-amd64.exe
```

Если `k6-windows-amd64.exe` лежит в корне проекта, `run.sh` обнаружит его автоматически.

PowerShell:
```powershell
.\run.ps1 -Scenario maximum -K6Bin .\k6-windows-amd64.exe
.\run.ps1 -Scenario stress
.\run.ps1 -Scenario reliability
.\run.ps1 -Scenario batch
```

## Сборка своего бинарника

Закреплённые версии: k6 `v1.8.2`, xk6 `v1.4.14`, `grafana/xk6-kafka` `v0.1.0`. Если portable-бинарник уже содержит `k6/x/kafka`, повторная сборка не нужна.

- Bash: `chmod +x build-k6.sh run.sh && ./build-k6.sh`
- PowerShell: `.\build-k6.ps1`

## Метрики и ограничения

HTTP: `http_reqs`, `http_req_duration`, `http_req_failed`, `checks`, `dropped_iterations`.

Kafka: `kafka_writer_message_count`, `kafka_writer_error_count`, `kafka_writer_message_bytes`, `kafka_writer_write_seconds`.

`ramping-arrival-rate` и `constant-arrival-rate` задают планируемую интенсивность итераций. Если генератор не успевает выделять VU, появятся `dropped_iterations`; это не следует считать фактически достигнутой нагрузкой на целевую систему.

HTTP endpoint'ы описаны в `lib/http.js` через `ENDPOINTS`; базовый URL и параметры запросов задаются в `config/.env`. Проверьте тестовые данные и доступность endpoint'ов перед запуском. Kafka payload и функции генерации находятся непосредственно в каждом из 17 файлов `scripts/kafka_NN.js`. В каждом из 17 топиков отправляется JSON с полями из предоставленного примера EQ journal; `GFCUS`, дата, P3R, CTP и timestamp генерируются динамически. Структура payload единая для всех топиков — проверьте соответствие схемам конкретных топиков перед промышленным прогоном. Архив не проверялся подключением к вашему Kafka-кластеру и HTTP-сервисам; перед длительным прогоном выполните короткую проверку на небольшой нагрузке.

Документация:
- https://github.com/grafana/xk6-kafka
- https://pkg.go.dev/github.com/grafana/xk6-kafka@v0.1.0/pkg/kafka
- https://grafana.com/docs/k6/latest/using-k6/scenarios/
