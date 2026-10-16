// ==========================================================================
// Storm-Track Ultra 2.0 - Meteorological Domain Data & Historical Case Archive
// ==========================================================================

const HKO_HQ = {
    name: '香港天文台總部',
    en: 'HKO Headquarters',
    lat: 22.3022,
    lon: 114.1746
};

const STORM_AGENCIES = [
    { id: 'CONSENSUS', name: '共識路徑 Beta', short: 'CONSENSUS', color: '#00F5D4', weight: 1.0, dashed: false, isConsensus: true },
    { id: 'HKO',       name: '香港天文台',   short: 'HKO',       color: '#FF2E63', weight: 1.25, dashed: false },
    { id: 'JMA',       name: '日本氣象廳',   short: 'JMA',       color: '#38BDF8', weight: 1.10, dashed: true  },
    { id: 'CMA',       name: '中央氣象台',   short: 'CMA',       color: '#FBBF24', weight: 1.00, dashed: true  },
    { id: 'CWA',       name: '台灣氣象署',   short: 'CWA',       color: '#A855F7', weight: 0.95, dashed: true  },
    { id: 'JTWC',      name: '美軍聯颱中心', short: 'JTWC',      color: '#FB923C', weight: 1.05, dashed: true  }
];

const HKO_REFERENCE_STATIONS = [
    { id: 'CCH', name: '長洲',     en: 'Cheung Chau',   lat: 22.2011, lon: 114.0267, role: '八大參考站', exposure: 1.26, elevation: '72m' },
    { id: 'CLK', name: '赤鱲角',   en: 'Chek Lap Kok',  lat: 22.3094, lon: 113.9219, role: '八大參考站', exposure: 1.15, elevation: '14m' },
    { id: 'TY1', name: '青衣',     en: 'Tsing Yi',      lat: 22.3453, lon: 114.0861, role: '八大參考站', exposure: 0.96, elevation: '50m' },
    { id: 'SE1', name: '啟德',     en: 'Kai Tak',       lat: 22.3097, lon: 114.2133, role: '八大參考站', exposure: 0.94, elevation: '16m' },
    { id: 'SKG', name: '西貢',     en: 'Sai Kung',      lat: 22.3756, lon: 114.2744, role: '八大參考站', exposure: 1.08, elevation: '10m' },
    { id: 'SHA', name: '沙田',     en: 'Sha Tin',       lat: 22.4025, lon: 114.2100, role: '八大參考站', exposure: 0.78, elevation: '16m' },
    { id: 'WLP', name: '濕地公園', en: 'Wetland Park',  lat: 22.4667, lon: 114.0086, role: '八大參考站', exposure: 0.82, elevation: '11m' },
    { id: 'TKL', name: '打鼓嶺',   en: 'Ta Kwu Ling',   lat: 22.5286, lon: 114.1567, role: '八大參考站', exposure: 0.75, elevation: '28m' },
    { id: 'WGL', name: '橫瀾島',   en: 'Waglan Island', lat: 22.1822, lon: 114.3033, role: '離岸前哨站', exposure: 1.38, elevation: '83m', isOutpost: true },
    { id: 'NGP', name: '昂坪',     en: 'Ngong Ping',    lat: 22.2586, lon: 113.9128, role: '高地前哨站', exposure: 1.52, elevation: '593m', isOutpost: true }
];

const STORM_CASES_ARCHIVE = [
    {
        id: '2025-ragasa',
        code: '2518',
        nameZh: '樺加沙',
        nameEn: 'RAGASA',
        category: 'SuperTY',
        categoryName: '超強颱風 (Super Typhoon)',
        badgeColor: '#C084FC',
        peakSignal: '十號颶風信號 (T10) / 八號烈風信號',
        baseTime: '2025-09-23T08:00:00+08:00',
        summary: '2025 年南海巔峰秋颱代表個案。環流緊密且強度極高（中心風速達 205 km/h），由呂宋海峽移入南海北部後以西北偏西路徑逼近珠江口南側約 105–125 公里，令香港處於極具破壞力的右半圓（危險半圓）東南烈風至暴風區。',
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
        categoryName: '強烈熱帶風暴 (Severe Tropical Storm)',
        badgeColor: '#F59E0B',
        peakSignal: '三號強風信號 / 八號邊緣評估',
        baseTime: '2026-07-18T14:00:00+08:00',
        summary: '2026 年夏季南海季風槽生成個案。外圍強風圈廣闊但中心整合受垂直風切變制約，於香港西南偏南約 235 公里掠過，考驗八大測風站「強風高企但烈風僅離岸達標」之 T3 / T8 臨界決策基準。',
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
        categoryName: '超強颱風 (Super Typhoon)',
        badgeColor: '#EF4444',
        peakSignal: '十號颶風信號 (T10)',
        baseTime: '2023-09-01T08:00:00+08:00',
        summary: '2023 年正面襲港十號風球經典案例。蘇拉擁有極為緊密且完整的雙眼牆結構，中心於香港天文台以南約 40 公里近距離掠過，本港多處錄得颶風程度風力。',
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
        categoryName: '超強颱風 (Super Typhoon)',
        badgeColor: '#EC4899',
        peakSignal: '十號颶風信號 (T10 • 持續 10 小時)',
        baseTime: '2018-09-16T02:00:00+08:00',
        summary: '2018 年破壞力驚人之巨型環流指標個案。山竹雖然曾橫過呂宋北部，但重組後烈風圈半徑仍逾 400 公里，並以時速 30 公里高速於香港西南偏南約 100 公里掠過，引發破紀錄風暴潮及全港廣泛颶風。',
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
window.STORM_CASES_ARCHIVE = STORM_CASES_ARCHIVE;
