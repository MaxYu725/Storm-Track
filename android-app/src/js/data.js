// ==========================================================================
// Storm-Track Ultra 2.1 - Meteorological Data, Built-in Keyless Coastline GeoJSON
// & Historical Case Archive
// ==========================================================================

const HKO_HQ = {
    name: '香港天文台總部',
    en: 'HKO Headquarters',
    lat: 22.3022,
    lon: 114.1746
};

// Default only HKO and CONSENSUS enabled on map so initial map view is super clean!
const STORM_AGENCIES = [
    { id: 'CONSENSUS', name: '多機構共識', short: 'CONSENSUS', color: '#00F5D4', weight: 1.0, dashed: false, isConsensus: true, defaultOn: true },
    { id: 'HKO',       name: '香港天文台', short: 'HKO',       color: '#FF2E63', weight: 1.25, dashed: false, defaultOn: true },
    { id: 'JMA',       name: '日本氣象廳', short: 'JMA',       color: '#38BDF8', weight: 1.10, dashed: true,  defaultOn: false },
    { id: 'CMA',       name: '中央氣象台', short: 'CMA',       color: '#FBBF24', weight: 1.00, dashed: true,  defaultOn: false },
    { id: 'CWA',       name: '台灣氣象署', short: 'CWA',       color: '#A855F7', weight: 0.95, dashed: true,  defaultOn: false },
    { id: 'JTWC',      name: '美軍聯颱',   short: 'JTWC',      color: '#FB923C', weight: 1.05, dashed: true,  defaultOn: false }
];

const HKO_REFERENCE_STATIONS = [
    { id: 'CCH', name: '長洲',     en: 'Cheung Chau',   lat: 22.2011, lon: 114.0267, role: '八大參考站', exposure: 1.26 },
    { id: 'CLK', name: '赤鱲角',   en: 'Chek Lap Kok',  lat: 22.3094, lon: 113.9219, role: '八大參考站', exposure: 1.15 },
    { id: 'TY1', name: '青衣',     en: 'Tsing Yi',      lat: 22.3453, lon: 114.0861, role: '八大參考站', exposure: 0.96 },
    { id: 'SE1', name: '啟德',     en: 'Kai Tak',       lat: 22.3097, lon: 114.2133, role: '八大參考站', exposure: 0.94 },
    { id: 'SKG', name: '西貢',     en: 'Sai Kung',      lat: 22.3756, lon: 114.2744, role: '八大參考站', exposure: 1.08 },
    { id: 'SHA', name: '沙田',     en: 'Sha Tin',       lat: 22.4025, lon: 114.2100, role: '八大參考站', exposure: 0.78 },
    { id: 'WLP', name: '濕地公園', en: 'Wetland Park',  lat: 22.4667, lon: 114.0086, role: '八大參考站', exposure: 0.82 },
    { id: 'TKL', name: '打鼓嶺',   en: 'Ta Kwu Ling',   lat: 22.5286, lon: 114.1567, role: '八大參考站', exposure: 0.75 }
];

// Built-in Zero-Key Vector Coastlines for South China Sea, HK, Taiwan, Philippines, Hainan, Vietnam & Japan
// Guarantees the map is ALWAYS visible even if all external tile servers are blocked or offline!
const BUILTIN_COASTLINE_POLYLINES = [
    // South China / Guangdong / Fujian / Zhejiang Coastline
    [[21.5, 108.0], [21.6, 109.1], [21.2, 109.8], [20.3, 110.1], [21.1, 110.4], [21.5, 111.8], [21.8, 112.9], [22.1, 113.5], [22.5, 113.9], [22.25, 114.15], [22.35, 114.35], [22.6, 114.5], [22.7, 115.6], [23.3, 116.7], [23.8, 117.5], [24.5, 118.1], [25.4, 119.5], [26.6, 120.0], [28.0, 121.2], [30.0, 121.8], [31.2, 121.9]],
    // Hong Kong Lantau & HK Island Detail
    [[22.21, 113.84], [22.28, 113.92], [22.33, 114.01], [22.25, 114.04], [22.21, 113.84]],
    [[22.28, 114.13], [22.28, 114.24], [22.21, 114.25], [22.23, 114.14], [22.28, 114.13]],
    // Hainan Island
    [[20.0, 110.1], [20.1, 110.9], [19.6, 111.0], [18.8, 110.5], [18.2, 109.5], [18.5, 108.7], [19.3, 108.6], [19.9, 109.5], [20.0, 110.1]],
    // Taiwan Island
    [[25.3, 121.5], [25.0, 122.0], [24.0, 121.6], [22.9, 121.2], [21.9, 120.8], [22.6, 120.3], [23.5, 120.1], [24.6, 120.7], [25.3, 121.5]],
    // Luzon & Philippines
    [[18.5, 120.6], [18.4, 122.2], [16.5, 122.4], [15.0, 121.6], [14.0, 122.5], [12.6, 124.1], [13.1, 123.0], [14.5, 120.9], [14.8, 120.2], [16.0, 119.8], [17.5, 120.4], [18.5, 120.6]],
    // Mindanao / Visayas简化
    [[11.5, 125.0], [10.0, 125.5], [8.0, 126.3], [6.2, 125.2], [7.0, 122.1], [9.5, 122.5], [11.5, 125.0]],
    // Vietnam Coast
    [[21.5, 108.0], [20.5, 106.6], [18.8, 105.8], [16.5, 107.6], [15.0, 108.9], [12.2, 109.2], [10.3, 107.1]],
    // Okinawa & Kyushu (Japan)
    [[26.1, 127.7], [26.8, 128.3], [28.3, 129.5], [30.4, 130.5], [31.2, 130.6], [32.8, 130.0], [33.9, 130.9], [33.0, 131.8], [31.4, 131.4]]
];

const STORM_CASES_ARCHIVE = [
    {
        id: '2025-ragasa',
        code: '2518',
        nameZh: '樺加沙',
        nameEn: 'RAGASA',
        category: 'SuperTY',
        categoryName: '超強颱風',
        badgeColor: '#C084FC',
        peakSignal: '十號颶風信號 (T10)',
        baseTime: '2025-09-23T08:00:00+08:00',
        summary: '2025 年南海巔峰秋颱個案（中心風速 205 km/h），於珠江口南側約 110 公里掠過，香港處於危險半圓東南烈風至暴風區。',
        agencies: {
            HKO: [
                { h: -12, lat: 19.6, lon: 118.4, windKmh: 185, pres: 925 },
                { h: 0,   lat: 20.4, lon: 116.8, windKmh: 195, pres: 918 },
                { h: 12,  lat: 21.1, lon: 115.4, windKmh: 205, pres: 912 },
                { h: 24,  lat: 21.5, lon: 114.0, windKmh: 195, pres: 918 },
                { h: 36,  lat: 21.8, lon: 112.7, windKmh: 165, pres: 940 },
                { h: 48,  lat: 22.1, lon: 111.3, windKmh: 120, pres: 968 },
                { h: 72,  lat: 22.6, lon: 108.8, windKmh: 75,  pres: 990 },
                { h: 96,  lat: 23.0, lon: 106.5, windKmh: 50,  pres: 1000 }
            ],
            JMA: [
                { h: -12, lat: 19.5, lon: 118.5, windKmh: 180, pres: 925 },
                { h: 0,   lat: 20.3, lon: 116.9, windKmh: 195, pres: 915 },
                { h: 12,  lat: 21.0, lon: 115.5, windKmh: 205, pres: 910 },
                { h: 24,  lat: 21.4, lon: 114.2, windKmh: 190, pres: 920 },
                { h: 36,  lat: 21.7, lon: 112.9, windKmh: 160, pres: 945 },
                { h: 48,  lat: 22.0, lon: 111.5, windKmh: 115, pres: 970 },
                { h: 72,  lat: 22.5, lon: 109.0, windKmh: 70,  pres: 992 },
                { h: 96,  lat: 22.9, lon: 106.8, windKmh: 48,  pres: 1002 }
            ],
            CMA: [
                { h: -12, lat: 19.6, lon: 118.4, windKmh: 190, pres: 922 },
                { h: 0,   lat: 20.5, lon: 116.7, windKmh: 205, pres: 912 },
                { h: 12,  lat: 21.2, lon: 115.3, windKmh: 215, pres: 905 },
                { h: 24,  lat: 21.6, lon: 113.9, windKmh: 200, pres: 915 },
                { h: 36,  lat: 21.9, lon: 112.5, windKmh: 170, pres: 938 },
                { h: 48,  lat: 22.2, lon: 111.1, windKmh: 125, pres: 965 },
                { h: 72,  lat: 22.7, lon: 108.6, windKmh: 80,  pres: 988 },
                { h: 96,  lat: 23.1, lon: 106.3, windKmh: 55,  pres: 998 }
            ],
            CWA: [
                { h: -12, lat: 19.5, lon: 118.4, windKmh: 185, pres: 925 },
                { h: 0,   lat: 20.3, lon: 116.8, windKmh: 198, pres: 916 },
                { h: 12,  lat: 20.9, lon: 115.3, windKmh: 205, pres: 912 },
                { h: 24,  lat: 21.3, lon: 113.8, windKmh: 188, pres: 922 },
                { h: 36,  lat: 21.6, lon: 112.4, windKmh: 155, pres: 948 },
                { h: 48,  lat: 21.9, lon: 111.0, windKmh: 110, pres: 972 },
                { h: 72,  lat: 22.4, lon: 108.5, windKmh: 68,  pres: 994 },
                { h: 96,  lat: 22.8, lon: 106.2, windKmh: 45,  pres: 1002 }
            ],
            JTWC: [
                { h: -12, lat: 19.6, lon: 118.3, windKmh: 195, pres: 920 },
                { h: 0,   lat: 20.4, lon: 116.7, windKmh: 210, pres: 910 },
                { h: 12,  lat: 21.1, lon: 115.2, windKmh: 220, pres: 904 },
                { h: 24,  lat: 21.5, lon: 113.9, windKmh: 205, pres: 914 },
                { h: 36,  lat: 21.8, lon: 112.6, windKmh: 168, pres: 940 },
                { h: 48,  lat: 22.1, lon: 111.2, windKmh: 120, pres: 968 },
                { h: 72,  lat: 22.6, lon: 108.7, windKmh: 72,  pres: 990 },
                { h: 96,  lat: 23.0, lon: 106.4, windKmh: 50,  pres: 1000 }
            ]
        }
    },
    {
        id: '2026-noul',
        code: '2605',
        nameZh: '紅霞',
        nameEn: 'NOUL',
        category: 'STS',
        categoryName: '強烈熱帶風暴',
        badgeColor: '#F59E0B',
        peakSignal: '三號強風 / 八號邊緣',
        baseTime: '2026-07-18T14:00:00+08:00',
        summary: '2026 年夏季南海季風槽個案，於香港西南偏南約 235 公里掠過，呈現「強風普遍達標、離岸烈風」之 T3/T8 臨界型態。',
        agencies: {
            HKO: [
                { h: -12, lat: 17.8, lon: 116.5, windKmh: 85,  pres: 988 },
                { h: 0,   lat: 18.9, lon: 115.4, windKmh: 105, pres: 980 },
                { h: 12,  lat: 19.8, lon: 114.2, windKmh: 115, pres: 975 },
                { h: 24,  lat: 20.4, lon: 113.0, windKmh: 118, pres: 974 },
                { h: 36,  lat: 20.9, lon: 111.7, windKmh: 110, pres: 978 },
                { h: 48,  lat: 21.4, lon: 110.4, windKmh: 90,  pres: 986 },
                { h: 72,  lat: 22.0, lon: 108.0, windKmh: 65,  pres: 995 },
                { h: 96,  lat: 22.4, lon: 105.8, windKmh: 45,  pres: 1002 }
            ],
            JMA: [
                { h: -12, lat: 17.7, lon: 116.6, windKmh: 82,  pres: 990 },
                { h: 0,   lat: 18.8, lon: 115.5, windKmh: 100, pres: 982 },
                { h: 12,  lat: 19.6, lon: 114.4, windKmh: 110, pres: 976 },
                { h: 24,  lat: 20.2, lon: 113.2, windKmh: 115, pres: 975 },
                { h: 36,  lat: 20.7, lon: 111.9, windKmh: 105, pres: 980 },
                { h: 48,  lat: 21.2, lon: 110.6, windKmh: 85,  pres: 988 },
                { h: 72,  lat: 21.8, lon: 108.2, windKmh: 60,  pres: 996 },
                { h: 96,  lat: 22.2, lon: 106.0, windKmh: 42,  pres: 1003 }
            ],
            CMA: [
                { h: -12, lat: 17.9, lon: 116.4, windKmh: 88,  pres: 986 },
                { h: 0,   lat: 19.0, lon: 115.3, windKmh: 108, pres: 978 },
                { h: 12,  lat: 20.0, lon: 114.1, windKmh: 120, pres: 972 },
                { h: 24,  lat: 20.6, lon: 112.9, windKmh: 125, pres: 970 },
                { h: 36,  lat: 21.1, lon: 111.6, windKmh: 112, pres: 976 },
                { h: 48,  lat: 21.5, lon: 110.2, windKmh: 92,  pres: 985 },
                { h: 72,  lat: 22.1, lon: 107.8, windKmh: 68,  pres: 994 },
                { h: 96,  lat: 22.5, lon: 105.6, windKmh: 48,  pres: 1001 }
            ],
            CWA: [
                { h: -12, lat: 17.8, lon: 116.5, windKmh: 85,  pres: 988 },
                { h: 0,   lat: 18.8, lon: 115.3, windKmh: 102, pres: 980 },
                { h: 12,  lat: 19.7, lon: 114.1, windKmh: 112, pres: 975 },
                { h: 24,  lat: 20.3, lon: 112.8, windKmh: 115, pres: 974 },
                { h: 36,  lat: 20.8, lon: 111.5, windKmh: 105, pres: 979 },
                { h: 48,  lat: 21.3, lon: 110.2, windKmh: 88,  pres: 987 },
                { h: 72,  lat: 21.9, lon: 107.9, windKmh: 62,  pres: 995 },
                { h: 96,  lat: 22.3, lon: 105.7, windKmh: 44,  pres: 1002 }
            ],
            JTWC: [
                { h: -12, lat: 17.9, lon: 116.5, windKmh: 90,  pres: 986 },
                { h: 0,   lat: 19.0, lon: 115.4, windKmh: 110, pres: 978 },
                { h: 12,  lat: 19.9, lon: 114.3, windKmh: 120, pres: 973 },
                { h: 24,  lat: 20.5, lon: 113.1, windKmh: 122, pres: 972 },
                { h: 36,  lat: 21.0, lon: 111.8, windKmh: 110, pres: 978 },
                { h: 48,  lat: 21.5, lon: 110.5, windKmh: 90,  pres: 986 },
                { h: 72,  lat: 22.0, lon: 108.1, windKmh: 65,  pres: 995 },
                { h: 96,  lat: 22.4, lon: 105.9, windKmh: 45,  pres: 1002 }
            ]
        }
    },
    {
        id: '2023-saola',
        code: '2309',
        nameZh: '蘇拉',
        nameEn: 'SAOLA',
        category: 'SuperTY',
        categoryName: '超強颱風',
        badgeColor: '#EF4444',
        peakSignal: '十號颶風信號 (T10)',
        baseTime: '2023-09-01T08:00:00+08:00',
        summary: '2023 年正面襲港十號風球經典案例，中心於香港天文台以南約 40 公里掠過。',
        agencies: {
            HKO: [
                { h: -12, lat: 21.3, lon: 116.8, windKmh: 210, pres: 915 },
                { h: 0,   lat: 21.8, lon: 115.5, windKmh: 205, pres: 920 },
                { h: 12,  lat: 21.95,lon: 114.2, windKmh: 185, pres: 930 },
                { h: 24,  lat: 21.7, lon: 112.8, windKmh: 145, pres: 955 },
                { h: 36,  lat: 21.4, lon: 111.5, windKmh: 105, pres: 978 },
                { h: 48,  lat: 21.0, lon: 110.2, windKmh: 75,  pres: 990 },
                { h: 72,  lat: 20.3, lon: 108.5, windKmh: 50,  pres: 1000 },
                { h: 96,  lat: 19.8, lon: 107.2, windKmh: 40,  pres: 1004 }
            ],
            JMA: [
                { h: -12, lat: 21.2, lon: 116.9, windKmh: 205, pres: 915 },
                { h: 0,   lat: 21.7, lon: 115.6, windKmh: 198, pres: 922 },
                { h: 12,  lat: 21.9, lon: 114.3, windKmh: 180, pres: 935 },
                { h: 24,  lat: 21.6, lon: 112.9, windKmh: 140, pres: 958 },
                { h: 36,  lat: 21.3, lon: 111.6, windKmh: 100, pres: 980 },
                { h: 48,  lat: 20.9, lon: 110.3, windKmh: 70,  pres: 992 },
                { h: 72,  lat: 20.2, lon: 108.6, windKmh: 48,  pres: 1000 },
                { h: 96,  lat: 19.7, lon: 107.3, windKmh: 38,  pres: 1004 }
            ],
            CMA: [
                { h: -12, lat: 21.3, lon: 116.8, windKmh: 215, pres: 910 },
                { h: 0,   lat: 21.8, lon: 115.4, windKmh: 208, pres: 918 },
                { h: 12,  lat: 22.0, lon: 114.1, windKmh: 190, pres: 928 },
                { h: 24,  lat: 21.8, lon: 112.7, windKmh: 150, pres: 952 },
                { h: 36,  lat: 21.5, lon: 111.4, windKmh: 110, pres: 975 },
                { h: 48,  lat: 21.1, lon: 110.1, windKmh: 80,  pres: 988 },
                { h: 72,  lat: 20.4, lon: 108.4, windKmh: 55,  pres: 998 },
                { h: 96,  lat: 19.9, lon: 107.1, windKmh: 42,  pres: 1002 }
            ],
            CWA: [
                { h: -12, lat: 21.2, lon: 116.8, windKmh: 205, pres: 915 },
                { h: 0,   lat: 21.7, lon: 115.5, windKmh: 198, pres: 922 },
                { h: 12,  lat: 21.9, lon: 114.2, windKmh: 180, pres: 932 },
                { h: 24,  lat: 21.6, lon: 112.8, windKmh: 142, pres: 956 },
                { h: 36,  lat: 21.3, lon: 111.5, windKmh: 102, pres: 979 },
                { h: 48,  lat: 20.9, lon: 110.2, windKmh: 72,  pres: 991 },
                { h: 72,  lat: 20.2, lon: 108.5, windKmh: 48,  pres: 1000 },
                { h: 96,  lat: 19.7, lon: 107.2, windKmh: 38,  pres: 1004 }
            ],
            JTWC: [
                { h: -12, lat: 21.3, lon: 116.7, windKmh: 220, pres: 912 },
                { h: 0,   lat: 21.8, lon: 115.4, windKmh: 210, pres: 918 },
                { h: 12,  lat: 21.95,lon: 114.1, windKmh: 188, pres: 930 },
                { h: 24,  lat: 21.7, lon: 112.7, windKmh: 148, pres: 954 },
                { h: 36,  lat: 21.4, lon: 111.4, windKmh: 105, pres: 978 },
                { h: 48,  lat: 21.0, lon: 110.1, windKmh: 75,  pres: 990 },
                { h: 72,  lat: 20.3, lon: 108.4, windKmh: 50,  pres: 1000 },
                { h: 96,  lat: 19.8, lon: 107.1, windKmh: 40,  pres: 1004 }
            ]
        }
    },
    {
        id: '2018-mangkhut',
        code: '1822',
        nameZh: '山竹',
        nameEn: 'MANGKHUT',
        category: 'SuperTY',
        categoryName: '超強颱風',
        badgeColor: '#EC4899',
        peakSignal: '十號颶風信號 (T10)',
        baseTime: '2018-09-16T02:00:00+08:00',
        summary: '2018 年巨型環流指標個案，烈風圈半徑逾 400 公里，於香港西南偏南約 100 公里掠過。',
        agencies: {
            HKO: [
                { h: -12, lat: 18.8, lon: 119.2, windKmh: 195, pres: 920 },
                { h: 0,   lat: 20.1, lon: 116.6, windKmh: 175, pres: 935 },
                { h: 12,  lat: 21.5, lon: 113.8, windKmh: 165, pres: 942 },
                { h: 24,  lat: 22.3, lon: 111.2, windKmh: 120, pres: 968 },
                { h: 36,  lat: 23.0, lon: 108.7, windKmh: 75,  pres: 990 },
                { h: 48,  lat: 23.6, lon: 106.5, windKmh: 50,  pres: 1000 },
                { h: 72,  lat: 24.2, lon: 104.2, windKmh: 35,  pres: 1006 },
                { h: 96,  lat: 24.6, lon: 102.8, windKmh: 30,  pres: 1008 }
            ],
            JMA: [
                { h: -12, lat: 18.7, lon: 119.3, windKmh: 190, pres: 922 },
                { h: 0,   lat: 20.0, lon: 116.7, windKmh: 175, pres: 935 },
                { h: 12,  lat: 21.4, lon: 113.9, windKmh: 160, pres: 945 },
                { h: 24,  lat: 22.2, lon: 111.3, windKmh: 115, pres: 970 },
                { h: 36,  lat: 22.9, lon: 108.8, windKmh: 72,  pres: 992 },
                { h: 48,  lat: 23.5, lon: 106.6, windKmh: 48,  pres: 1001 },
                { h: 72,  lat: 24.1, lon: 104.3, windKmh: 35,  pres: 1006 },
                { h: 96,  lat: 24.5, lon: 102.9, windKmh: 30,  pres: 1008 }
            ],
            CMA: [
                { h: -12, lat: 18.9, lon: 119.1, windKmh: 200, pres: 918 },
                { h: 0,   lat: 20.2, lon: 116.5, windKmh: 180, pres: 932 },
                { h: 12,  lat: 21.6, lon: 113.7, windKmh: 168, pres: 940 },
                { h: 24,  lat: 22.4, lon: 111.1, windKmh: 125, pres: 965 },
                { h: 36,  lat: 23.1, lon: 108.6, windKmh: 80,  pres: 988 },
                { h: 48,  lat: 23.7, lon: 106.4, windKmh: 52,  pres: 999 },
                { h: 72,  lat: 24.3, lon: 104.1, windKmh: 38,  pres: 1005 },
                { h: 96,  lat: 24.7, lon: 102.7, windKmh: 30,  pres: 1008 }
            ],
            CWA: [
                { h: -12, lat: 18.8, lon: 119.2, windKmh: 192, pres: 922 },
                { h: 0,   lat: 20.1, lon: 116.6, windKmh: 175, pres: 935 },
                { h: 12,  lat: 21.5, lon: 113.8, windKmh: 162, pres: 944 },
                { h: 24,  lat: 22.3, lon: 111.2, windKmh: 118, pres: 969 },
                { h: 36,  lat: 23.0, lon: 108.7, windKmh: 74,  pres: 991 },
                { h: 48,  lat: 23.6, lon: 106.5, windKmh: 50,  pres: 1000 },
                { h: 72,  lat: 24.2, lon: 104.2, windKmh: 35,  pres: 1006 },
                { h: 96,  lat: 24.6, lon: 102.8, windKmh: 30,  pres: 1008 }
            ],
            JTWC: [
                { h: -12, lat: 18.8, lon: 119.1, windKmh: 205, pres: 916 },
                { h: 0,   lat: 20.1, lon: 116.5, windKmh: 185, pres: 930 },
                { h: 12,  lat: 21.5, lon: 113.7, windKmh: 170, pres: 940 },
                { h: 24,  lat: 22.3, lon: 111.1, windKmh: 122, pres: 966 },
                { h: 36,  lat: 23.0, lon: 108.6, windKmh: 76,  pres: 990 },
                { h: 48,  lat: 23.6, lon: 106.4, windKmh: 50,  pres: 1000 },
                { h: 72,  lat: 24.2, lon: 104.1, windKmh: 35,  pres: 1006 },
                { h: 96,  lat: 24.6, lon: 102.7, windKmh: 30,  pres: 1008 }
            ]
        }
    }
];

window.HKO_HQ = HKO_HQ;
window.STORM_AGENCIES = STORM_AGENCIES;
window.HKO_REFERENCE_STATIONS = HKO_REFERENCE_STATIONS;
window.BUILTIN_COASTLINE_POLYLINES = BUILTIN_COASTLINE_POLYLINES;
window.STORM_CASES_ARCHIVE = STORM_CASES_ARCHIVE;
