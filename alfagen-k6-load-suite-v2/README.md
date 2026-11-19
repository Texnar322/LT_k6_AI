# AlfaGen k6 Load Suite v2

Набор содержит **4 HTTP-скрипта и 10 Kafka producer-скриптов**. Все 14 сценариев запускаются параллельно в каждом из трёх основных режимов. Kafka-скрипты используют отдельные топики.

## Состав проекта

- `scripts/http_01_get.js` — HTTP GET.
- `scripts/http_02_post.js` — HTTP POST.
- `scripts/http_03_post.js` — HTTP POST.
- `scripts/http_04_put.js` — HTTP PUT.
- `scripts/kafka_01.js` ... `scripts/kafka_10.js` — 10 независимых Kafka producer'ов.
- `lib/profiles.js` — конфигурация трёх нагрузочных профилей и batch-режима.
- `lib/kafka.js` — единая конфигурация Kafka: brokers, SASL, SASL_PLAINTEXT, SASL_SSL, TLS, acks, timeout.
- `lib/http.js` — общий HTTP helper.
- `lib/workload.js` — сборка 14 функций в один тестовый набор.
- `scenarios/maximum.js` — ступенчатый поиск максимума.
- `scenarios/stress.js` — резкий выход на заданную нагрузку.
- `scenarios/reliability.js` — стабильная нагрузка 24 часа.
- `batch_100k.js` — отдельный пакетный запуск 100 000 сообщений на каждый из 10 Kafka-топиков.
- `run.sh`, `run.ps1` — запуск с portable k6 или k6 из PATH.

## Важное про интенсивность

Все значения rate задаются **на один скрипт**, а не на весь набор.

Например:
- `STRESS_HTTP_RATE=10` означает 10 итераций/с для каждого из 4 HTTP-скриптов, итого до 40 HTTP-запросов/с.
- `STRESS_KAFKA_RATE=10` означает 10 итераций/с для каждого из 10 Kafka-скриптов, итого до 100 Kafka-сообщений/с.

Одна итерация HTTP-скрипта выполняет один HTTP-запрос. Одна итерация Kafka-скрипта отправляет одно сообщение в топик, закреплённый за этим скриптом.

## Подготовка

```bash
cp config/.env.example config/.env
```

Заполните реальные HTTP URL, Kafka brokers, 10 топиков и учётные данные. `run.sh` автоматически загружает `config/.env`. Значения с особыми символами в пароле заключайте в кавычки.

PowerShell:
```powershell
Copy-Item config/.env.example config/.env
```

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

Топики задаются переменными `KAFKA_TOPIC_01` ... `KAFKA_TOPIC_10`. Если топик не задан, используются `alfagen.loadtest.topic01` ... `topic10`. Создайте топики заранее и оставьте `KAFKA_AUTO_CREATE_TOPIC=false`.

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

Одновременно запускаются 10 Kafka-сценариев. Каждый выполняет **100 000 итераций/отправок в собственный топик**. Итого — до 1 000 000 сообщений.

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

HTTP URL и JSON тела демонстрационные — замените их на реальные endpoint'ы и payload по контрактам API. Kafka payload также демонстрационный. Архив не проверялся подключением к вашему Kafka-кластеру и HTTP-сервисам; перед длительным прогоном выполните короткую проверку на небольшой нагрузке.

Документация:
- https://github.com/grafana/xk6-kafka
- https://pkg.go.dev/github.com/grafana/xk6-kafka@v0.1.0/pkg/kafka
- https://grafana.com/docs/k6/latest/using-k6/scenarios/
