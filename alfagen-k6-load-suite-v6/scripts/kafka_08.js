import { Writer } from "k6/x/kafka";
import { kafkaClientConfig } from "../lib/kafka.js";

// Независимый producer, JSON payload и генератор для alfadirect__partners_consumers__products__journal.
var topic = __ENV.KAFKA_TOPIC_08 || "alfadirect__partners_consumers__products__journal";
var writer = new Writer(kafkaClientConfig(topic));
var BASE_TIMESTAMP = Date.now() - 10000;
var cusCounter = 0;
var vuCounters = new Map();

function generateTimestamp(offsetMs) {
    var date = new Date(BASE_TIMESTAMP + offsetMs);
    if (isNaN(date.getTime())) throw new Error("Invalid timestamp: " + offsetMs);
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    var hours = String(date.getHours()).padStart(2, "0");
    var minutes = String(date.getMinutes()).padStart(2, "0");
    var seconds = String(date.getSeconds()).padStart(2, "0");
    var ms = String(date.getMilliseconds()).padStart(3, "0");
    var micro = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
    return year + "-" + month + "-" + day + " " + hours + ":" + minutes + ":" + seconds + "." + ms + micro;
}

function generateDateCode(date) {
    if (!date) {
        var daysAgo = Math.floor(Math.random() * 365) + 1;
        date = new Date(Date.now() - daysAgo * 86400000);
    }
    var year = date.getFullYear();
    var century = Math.floor((year - 1900) / 100);
    var yy = String(year % 100).padStart(2, "0");
    var mm = String(date.getMonth() + 1).padStart(2, "0");
    var dd = String(date.getDate()).padStart(2, "0");
    return parseInt(String(century) + yy + mm + dd, 10);
}

function generateP3R() {
    var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    return letters.charAt(Math.floor(Math.random() * letters.length)) +
        Math.floor(10 + Math.random() * 90);
}

function generateCtp() {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    var value = "";
    for (var i = 0; i < 2; i++) value += chars.charAt(Math.floor(Math.random() * chars.length));
    return value;
}

function generateMessage() {
    cusCounter++;
    var vuId = typeof __VU !== "undefined" ? __VU : 0;
    if (!vuCounters.has(vuId)) vuCounters.set(vuId, 0);
    var vuCounter = vuCounters.get(vuId) + 1;
    vuCounters.set(vuId, vuCounter);

    var payload = {
        GFCUS: "CUS" + String(vuCounter).padStart(3, "0"),
        GFCOD: generateDateCode(),
        GFP3R: generateP3R(),
        GFCTP: generateCtp(),
        eqTimestamp: generateTimestamp(-((vuCounter * 100) + Math.floor(Math.random() * 50))),
        GFHDD: " ", GFDFRQ: 0, GFYPLA: "N", GFC5R: " ",
        GFSTMP: "1002281104258902", GFOATP: "R ", GFC1R: " ", GFCREF: " ",
        GFDLM: 1250411, GFERCC: " ", GFGRP: " ", GFCNAI: "RU", GFCNAL: "RU",
        GFPCUS: " ", GFCNAR: "RU", GFERCP: " ", GFCNAP: "RU",
        GFCRB2: "B0", GFCRB1: "B0", GFDEL: " ", GFP4R: " ", GFCUNA: " ",
        GFCLTP: " ", GFACO: "FNA", GFYFON: "N", GFITRT: 0, GFCLTV: " ",
        GFGRPS: " ", GFCST: " ", GFC2R: " ", GFPCLC: " ", GFCS: " ",
        GFCLC: " ", GFCUNM: " ", GFPSTM: 0, GFMTB: " ", GFOCCL: "I ",
        GFRDDH: " ", GFDAS: "Куликов Н И ", GFDRC: "Y", GFCSSA: " ",
        GFADJ: 0, GFYOPI: "Y", GFETX: "N", GFLNM: " ", GFFCYC: " ",
        GFP5R: " ", GFSTN: 0, GFDASA: " ", GFYRET: "N", GFCLST: 9999999,
        GFBRNM: "MOGW", GFYNET: "N", GFDRTY: " ",
        GFCUN: "Куликов Никанор Измаилович ", GFCUB: "N", GFCUD: "N",
        GFP1R: " ", GFCUC: "N", GFCA2: " ", GFDDED: 0, GFYTRI: "N",
        GFCUZ: "N", GFCPNC: "BKB5NN", GFCFRQ: " ", GFSEID: " ",
        GFOCID: "BKB5NN ", GFC4R: " ", GFDCC: 0, GFYRI1: " ",
        GFFOL: "XXX ", GFYRI2: " ", GFYRI3: " ", GFFON: "BKB5NN ",
        GFYRI4: " ", GFMRTY: " ", GFCRF: " ", actionType: "MODIFY",
        GFAUNO: 0, GFP2R: " ", GFCLSF: 9999999, GFNSTM: 0, GFSAC: " "
    };
    return {
        key: payload.GFCUS + "-" + vuId + "-" + vuCounter,
        value: JSON.stringify(payload)
    };
}

export function kafka08() {
    var message = generateMessage();
    writer.produce({ messages: [{ key: message.key, value: message.value }] });
}
