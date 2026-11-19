import http from "k6/http";
import { check } from "k6";
import { SharedArray } from "k6/data";

var BASE_URL = (__ENV.BASE_URL || "http://localhost:8080").replace(/\/+$/, "");

// CSV format: one column named "cus"; one CUS value per row.
// The list is shared between VUs and values are distributed round-robin.
var CUS_LIST = new SharedArray("CUS list", function () {
    var rows = open("../data/cus.csv").split(/\r?\n/);
    var values = [];

    for (var i = 0; i < rows.length; i++) {
        var value = rows[i].trim();
        if (!value || value.toLowerCase() === "cus") {
            continue;
        }
        values.push(value.replace(/^"|"$/g, ""));
    }

    if (values.length === 0) {
        throw new Error("data/cus.csv does not contain any CUS values");
    }
    return values;
});

function val(name, fallback) {
    return __ENV[name] !== undefined && __ENV[name] !== "" ? __ENV[name] : fallback;
}

function nextCus() {
    // Deterministic round-robin selection across VUs and their iterations.
    var index = (__VU - 1 + __ITER) % CUS_LIST.length;
    return CUS_LIST[index];
}

function headers() {
    return {
        "Content-Type": "application/json; charset=utf-8",
        "Accept": "application/json"
    };
}

export const ENDPOINTS = {
    account: {
        method: "GET",
        requiresCus: true,
        buildUrl: function (params) {
            return BASE_URL + "/hotcache-nfs-account-info/v1/client/" +
                encodeURIComponent(params.cus) + "/account";
        },
        headers: headers(),
        checks: { "account: статус 200": function (r) { return r.status === 200; } }
    },
    currency: {
        method: "GET",
        requiresCus: false,
        buildUrl: function (params) {
            return BASE_URL + "/hotcache-nfs-account-info/v1/currency?rateDate=" +
                encodeURIComponent(params.rateDate);
        },
        headers: headers(),
        checks: { "currency: статус 200": function (r) { return r.status === 200; } }
    },
    aggregate: {
        method: "POST",
        requiresCus: true,
        buildUrl: function (params) {
            return BASE_URL + "/hotcache-nfs-account-info/v1/client/" +
                encodeURIComponent(params.cus) + "/aggregate";
        },
        headers: headers(),
        body: function (params) {
            return JSON.stringify({
                operation_amount: params.operation_amount,
                ean: params.ean
            });
        },
        checks: { "aggregate: статус 200": function (r) { return r.status === 200; } }
    },
    profile1: {
        method: "GET",
        requiresCus: false,
        buildUrl: function (params) {
            return BASE_URL + "/api/v1/profile/login?login=" +
                encodeURIComponent(params.login) +
                "&domains=" + encodeURIComponent(params.domains) +
                "&include=" + encodeURIComponent(params.include);
        },
        headers: headers(),
        checks: { "profile1: статус 200": function (r) { return r.status === 200; } }
    },
    profile2: {
        method: "GET",
        requiresCus: false,
        buildUrl: function (params) {
            return BASE_URL + "/api/v1/profile/email?login=" +
                encodeURIComponent(params.login) +
                "&fname=" + encodeURIComponent(params.fname) +
                "&lname=" + encodeURIComponent(params.lname) +
                "&email=" + encodeURIComponent(params.email);
        },
        headers: headers(),
        checks: { "profile2: статус 200": function (r) { return r.status === 200; } }
    }
};

function buildParams() {
    return {
        rateDate: val("HTTP_CURRENCY_RATE_DATE", "2025-10-09"),
        operation_amount: Number(val("HTTP_OPERATION_AMOUNT", "1000.02")),
        ean: val("HTTP_EAN", "40802810400000000123"),
        login: val("HTTP_PROFILE_LOGIN", "U_M2E7D"),
        domains: val("HTTP_PROFILE_DOMAINS", "MOSCOW,REGIONS"),
        include: val("HTTP_PROFILE_INCLUDE", "full"),
        fname: val("HTTP_PROFILE_FNAME", "Юрий"),
        lname: val("HTTP_PROFILE_LNAME", "Муравьёв"),
        email: val("HTTP_PROFILE_EMAIL", "muravev@alfabank.ru")
    };
}

export function executeEndpoint(name) {
    var endpoint = ENDPOINTS[name];
    if (!endpoint) {
        throw new Error("Unknown HTTP endpoint: " + name);
    }

    var params = buildParams();
    if (endpoint.requiresCus) {
        params.cus = nextCus();
    }

    var requestBody = endpoint.body ? endpoint.body(params) : null;
    var response = http.request(endpoint.method, endpoint.buildUrl(params), requestBody, {
        headers: endpoint.headers,
        timeout: __ENV.HTTP_TIMEOUT || "90s",
        tags: { test_type: "http", endpoint: name }
    });
    check(response, endpoint.checks);
    return response;
}
