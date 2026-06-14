import {NextResponse} from 'next/server';

// PLAN1-TASKS-FEATURE-20260509 — S8 OpenAPI 3.1 spec 박음.
// 외부 AI agent 영영 본 spec fetch 박음 영영 endpoint 영역 catch + Bearer auth chain 영영 박음.
// hardcoded JSON spec — zod-to-openapi 영영 박지 X (본 사이클 단순 docs 영영).
// 변경 시 `app/api/v1/tasks/route.ts` · `[id]/route.ts` · `lib/api-auth.ts` 영역 정합 의무.

const OPENAPI_SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'plan1 Task API',
    version: '1.0.0',
    description:
      'plan1 외부 AI agent REST API. 사용자 영영 자기 AI agent 박음 영영 task (할일) CRUD 박음 영영 영역. Bearer auth + token bucket rate limit (60/min/key).',
    contact: {
      name: 'cofounder.co.kr',
      url: 'https://cofounder.co.kr/project/plan1'
    }
  },
  servers: [
    {
      url: 'https://cofounder.co.kr/project/plan1',
      description: 'Production'
    }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'plan1_api_<40-char-base62>',
        description:
          'plan1 settings page 영영 발급 영영 API key. Authorization 헤더 영영 박음. 1회 노출 영영 — 발급 시점 복사 의무.'
      },
      // plan1-mobile A1 — schedules API 는 portal Better Auth 세션 JWT (cofounder_jwt) 인증.
      // task API 의 api-key 와 별개 경로 (모바일 앱 자기 데이터용).
      sessionAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'cofounder_jwt (portal Better Auth JWT)',
        description:
          'cofounder.co.kr 로그인 세션 JWT. Authorization: Bearer <cofounder_jwt> 또는 cofounder_jwt 쿠키. plan1-mobile 앱 전용.'
      }
    },
    schemas: {
      Task: {
        type: 'object',
        required: ['id', 'title', 'durationMin', 'categoryId', 'createdAt'],
        properties: {
          id: {
            type: 'string',
            example: 'task-550e8400-e29b-41d4-a716-446655440000',
            description: 'task UUID prefix `task-`'
          },
          title: {
            type: ['string', 'null'],
            maxLength: 500,
            example: '도서관 자료 정리'
          },
          durationMin: {
            type: ['integer', 'null'],
            minimum: 0,
            maximum: 10080,
            example: 30,
            description: '예상 소요시간 (분 · max 1주). null = 미정'
          },
          categoryId: {
            type: ['string', 'null'],
            example: 'cat-abc123',
            description: 'plan1 category id. null = 미분류 · stale FK = 자동 set null'
          },
          createdAt: {
            type: 'integer',
            format: 'int64',
            example: 1715300000000,
            description: 'Unix timestamp (ms · UTC)'
          }
        }
      },
      CreateTaskRequest: {
        type: 'object',
        properties: {
          title: {type: ['string', 'null'], minLength: 1, maxLength: 500},
          durationMin: {type: ['integer', 'null'], minimum: 0, maximum: 10080},
          categoryId: {type: ['string', 'null'], minLength: 1, maxLength: 100}
        },
        description: '모든 필드 nullable. 빈 task 영영 박음 OK (사용자 영영 settings 영영 채우기 영영).'
      },
      // plan1-mobile A1 — 스케줄 도메인 (cascade·insert-between·timer · 세션 JWT 인증).
      Schedule: {
        type: 'object',
        required: [
          'id',
          'title',
          'categoryId',
          'startAt',
          'durationMin',
          'timerType',
          'status',
          'chainedToPrev',
          'createdAt',
          'updatedAt'
        ],
        properties: {
          id: {type: 'string', example: 'sch-550e8400-e29b-41d4-a716-446655440000'},
          title: {type: 'string', maxLength: 500},
          categoryId: {type: 'string', description: 'plan1 category id (소유 검증)'},
          startAt: {type: 'integer', format: 'int64', description: '시작 시각 (Unix ms · UTC)'},
          durationMin: {type: 'integer', minimum: 0, maximum: 10080},
          actualDurationMin: {type: ['integer', 'null'], description: '완료 시 실제 소요 (분)'},
          timerType: {type: 'string', enum: ['countup', 'timer1', 'countdown']},
          status: {type: 'string', enum: ['pending', 'active', 'done']},
          chainedToPrev: {type: 'boolean', description: 'cascade 연속 체인 여부 (default true)'},
          createdAt: {type: 'integer', format: 'int64'},
          updatedAt: {
            type: 'integer',
            format: 'int64',
            description: '낙관적 동시성 토큰 (write 시 갱신)'
          }
        }
      },
      CreateScheduleRequest: {
        type: 'object',
        required: ['title', 'categoryId', 'startAt', 'durationMin', 'timerType'],
        properties: {
          title: {type: 'string', minLength: 1, maxLength: 500},
          categoryId: {type: 'string', minLength: 1, maxLength: 100},
          startAt: {type: 'integer', format: 'int64'},
          durationMin: {type: 'integer', minimum: 0, maximum: 10080},
          timerType: {type: 'string', enum: ['countup', 'timer1', 'countdown']},
          chainedToPrev: {type: 'boolean'}
        }
      },
      UpdateScheduleRequest: {
        type: 'object',
        minProperties: 1,
        properties: {
          startAt: {type: 'integer', format: 'int64'},
          durationMin: {type: 'integer', minimum: 0, maximum: 10080},
          title: {type: 'string', minLength: 1, maxLength: 500},
          categoryId: {type: 'string', minLength: 1, maxLength: 100},
          timerType: {type: 'string', enum: ['countup', 'timer1', 'countdown']},
          chainedToPrev: {type: 'boolean'}
        },
        description:
          '부분 갱신 (최소 1필드). startAt/durationMin 변경은 cascade 로 뒤 체인 전파. 결과가 MAX_OVERLAP(2) 위반이면 422.'
      },
      // plan1-mobile A1 — 카테고리 / 설정 (세션 JWT 인증).
      Category: {
        type: 'object',
        required: ['id', 'name', 'color', 'createdAt'],
        properties: {
          id: {type: 'string', example: 'cat-abc123'},
          name: {type: 'string', maxLength: 100, description: '사용자 내 unique'},
          color: {type: 'string', example: '#6b7280'},
          createdAt: {type: 'integer', format: 'int64'}
        }
      },
      CreateCategoryRequest: {
        type: 'object',
        required: ['name', 'color'],
        properties: {
          name: {type: 'string', minLength: 1, maxLength: 100},
          color: {type: 'string', minLength: 1, maxLength: 32}
        }
      },
      AppSettings: {
        type: 'object',
        required: ['theme', 'focusViewMin', 'zoomPxPerHour'],
        properties: {
          theme: {type: 'string', enum: ['light', 'dark', 'system']},
          focusViewMin: {
            type: 'integer',
            description: '집중 보기 (분 · 옵션 240·360·480·600·720·960·1200·1440)'
          },
          zoomPxPerHour: {type: 'integer', description: '시간 간격 줌 (읽기 전용)'}
        }
      },
      SuccessResponse: {
        type: 'object',
        required: ['data', 'error'],
        properties: {
          data: {description: 'response payload'},
          error: {type: 'null'}
        }
      },
      ErrorResponse: {
        type: 'object',
        required: ['data', 'error'],
        properties: {
          data: {type: 'null'},
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: {
                type: 'string',
                enum: [
                  'unauthorized',
                  'rate_limited',
                  'invalid_json',
                  'invalid_input',
                  'invalid_id',
                  'category_not_found',
                  'task_not_found',
                  'schedule_not_found',
                  'overlap_exceeded',
                  'insert_between_stale',
                  'insert_between_no_prev',
                  'concurrency_conflict',
                  'create_failed',
                  'internal_error'
                ]
              },
              message: {type: 'string'}
            }
          }
        }
      }
    }
  },
  security: [{bearerAuth: []}],
  paths: {
    '/api/v1/tasks': {
      get: {
        summary: 'list tasks',
        description: '본 API key 영영 사용자 영영 task 영영 reverse chronological 영영 list 박음.',
        responses: {
          '200': {
            description: 'OK',
            headers: {
              'X-RateLimit-Limit': {schema: {type: 'integer', example: 60}},
              'X-RateLimit-Remaining': {schema: {type: 'integer', example: 59}},
              'X-RateLimit-Reset': {schema: {type: 'integer', format: 'int64'}}
            },
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    {$ref: '#/components/schemas/SuccessResponse'},
                    {
                      type: 'object',
                      properties: {
                        data: {type: 'array', items: {$ref: '#/components/schemas/Task'}}
                      }
                    }
                  ]
                }
              }
            }
          },
          '401': {
            description: 'Unauthorized — bearer auth 영영 X 영영 invalid 영영',
            content: {'application/json': {schema: {$ref: '#/components/schemas/ErrorResponse'}}}
          },
          '429': {
            description: 'Rate limited — token bucket 영영 X (60/min cap)',
            content: {'application/json': {schema: {$ref: '#/components/schemas/ErrorResponse'}}}
          }
        }
      },
      post: {
        summary: 'create task',
        description: '신규 task 박음. 모든 필드 nullable.',
        requestBody: {
          required: true,
          content: {
            'application/json': {schema: {$ref: '#/components/schemas/CreateTaskRequest'}}
          }
        },
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    {$ref: '#/components/schemas/SuccessResponse'},
                    {
                      type: 'object',
                      properties: {data: {$ref: '#/components/schemas/Task'}}
                    }
                  ]
                }
              }
            }
          },
          '400': {
            description: 'Invalid JSON 또는 zod validation 실패',
            content: {'application/json': {schema: {$ref: '#/components/schemas/ErrorResponse'}}}
          },
          '401': {description: 'Unauthorized'},
          '404': {description: 'Category not found 또는 IDOR 차단 (다른 사용자 category)'},
          '429': {description: 'Rate limited'}
        }
      },
      options: {
        summary: 'CORS preflight',
        responses: {'204': {description: 'CORS headers 박음'}}
      }
    },
    '/api/v1/tasks/{id}': {
      delete: {
        summary: 'delete task',
        description: '본 API key 영영 사용자 영영 task 만 삭제 영영 (IDOR 차단).',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: {type: 'string'},
            example: 'task-550e8400-e29b-41d4-a716-446655440000'
          }
        ],
        responses: {
          '204': {description: 'Deleted'},
          '401': {description: 'Unauthorized'},
          '404': {description: 'Task not found 또는 IDOR 차단'},
          '429': {description: 'Rate limited'}
        }
      },
      options: {
        summary: 'CORS preflight',
        responses: {'204': {description: 'CORS headers 박음'}}
      }
    },
    '/api/v1/schedules': {
      get: {
        summary: 'list schedules',
        description: '세션 사용자의 스케줄 전체 목록.',
        security: [{sessionAuth: []}],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    {$ref: '#/components/schemas/SuccessResponse'},
                    {
                      type: 'object',
                      properties: {
                        data: {type: 'array', items: {$ref: '#/components/schemas/Schedule'}}
                      }
                    }
                  ]
                }
              }
            }
          },
          '401': {description: 'Unauthorized — 세션 JWT 없음/만료/invalid'}
        }
      },
      post: {
        summary: 'create schedule',
        description: '신규 스케줄 생성. 결과 전체 스케줄 목록 반환.',
        security: [{sessionAuth: []}],
        requestBody: {
          required: true,
          content: {
            'application/json': {schema: {$ref: '#/components/schemas/CreateScheduleRequest'}}
          }
        },
        responses: {
          '201': {
            description: 'Created — 갱신된 전체 스케줄 목록',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    {$ref: '#/components/schemas/SuccessResponse'},
                    {
                      type: 'object',
                      properties: {
                        data: {type: 'array', items: {$ref: '#/components/schemas/Schedule'}}
                      }
                    }
                  ]
                }
              }
            }
          },
          '400': {description: 'Invalid JSON 또는 zod validation 실패'},
          '401': {description: 'Unauthorized'},
          '404': {description: 'Category not found 또는 IDOR 차단'},
          '422': {description: 'MAX_OVERLAP(2) 위반'}
        }
      },
      options: {summary: 'CORS preflight', responses: {'204': {description: 'CORS headers'}}}
    },
    '/api/v1/schedules/{id}': {
      patch: {
        summary: 'update schedule',
        description: '부분 갱신. startAt/durationMin 변경은 cascade 로 뒤 체인 전파.',
        security: [{sessionAuth: []}],
        parameters: [
          {name: 'id', in: 'path', required: true, schema: {type: 'string'}}
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {schema: {$ref: '#/components/schemas/UpdateScheduleRequest'}}
          }
        },
        responses: {
          '200': {
            description: 'OK — 갱신된 전체 스케줄 목록',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    {$ref: '#/components/schemas/SuccessResponse'},
                    {
                      type: 'object',
                      properties: {
                        data: {type: 'array', items: {$ref: '#/components/schemas/Schedule'}}
                      }
                    }
                  ]
                }
              }
            }
          },
          '400': {description: 'Invalid input'},
          '401': {description: 'Unauthorized'},
          '404': {description: 'Schedule/category not found 또는 IDOR 차단'},
          '409': {description: 'Concurrency conflict — 다른 세션이 그 사이 변경 (refetch 후 재시도)'},
          '422': {description: 'MAX_OVERLAP(2) 위반'}
        }
      },
      delete: {
        summary: 'delete schedule',
        description: '세션 사용자의 스케줄만 삭제 (IDOR 차단).',
        security: [{sessionAuth: []}],
        parameters: [
          {name: 'id', in: 'path', required: true, schema: {type: 'string'}}
        ],
        responses: {
          '200': {description: 'Deleted'},
          '401': {description: 'Unauthorized'},
          '404': {description: 'Not found 또는 IDOR 차단'}
        }
      },
      options: {summary: 'CORS preflight', responses: {'204': {description: 'CORS headers'}}}
    },
    '/api/v1/schedules/{id}/complete': {
      post: {
        summary: 'complete schedule',
        description:
          '스케줄 완료 — actualDurationMin 기록 + cascade delta 전파 + completedAt 기록.',
        security: [{sessionAuth: []}],
        parameters: [
          {name: 'id', in: 'path', required: true, schema: {type: 'string'}}
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['completeAtMs'],
                properties: {
                  completeAtMs: {type: 'integer', format: 'int64', description: '완료 시각 (Unix ms)'}
                }
              }
            }
          }
        },
        responses: {
          '200': {description: 'OK — 갱신된 전체 스케줄 목록'},
          '400': {description: 'Invalid input'},
          '401': {description: 'Unauthorized'},
          '404': {description: 'Schedule not found 또는 IDOR 차단'},
          '409': {description: 'Concurrency conflict'},
          '422': {description: 'MAX_OVERLAP(2) 위반'}
        }
      },
      options: {summary: 'CORS preflight', responses: {'204': {description: 'CORS headers'}}}
    },
    '/api/v1/schedules/insert-between': {
      post: {
        summary: 'insert schedule between',
        description:
          '새 스케줄을 충돌 스케줄 시작 위치에 "사이 삽입" (갭 보존 + cascade 밀기). expectedConflictStart 불일치 시 409.',
        security: [{sessionAuth: []}],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: [
                  'title',
                  'categoryId',
                  'durationMin',
                  'timerType',
                  'conflictId',
                  'expectedConflictStart'
                ],
                properties: {
                  title: {type: 'string', minLength: 1, maxLength: 500},
                  categoryId: {type: 'string', minLength: 1, maxLength: 100},
                  durationMin: {type: 'integer', minimum: 0, maximum: 10080},
                  timerType: {type: 'string', enum: ['countup', 'timer1', 'countdown']},
                  conflictId: {type: 'string', description: '사이 삽입 기준 충돌 스케줄 id'},
                  expectedConflictStart: {
                    type: 'integer',
                    format: 'int64',
                    description: '클라가 본 충돌 스케줄 startAt (TOCTOU 가드)'
                  }
                }
              }
            }
          }
        },
        responses: {
          '201': {description: 'Created — 갱신된 전체 스케줄 목록'},
          '400': {description: 'Invalid input'},
          '401': {description: 'Unauthorized'},
          '404': {description: 'Category not found 또는 IDOR 차단'},
          '409': {description: 'insert_between_stale — 충돌 스케줄이 그 사이 변경/삭제됨'},
          '422': {
            description: 'insert_between_no_prev (앞 active 없음) 또는 MAX_OVERLAP(2) 위반'
          }
        }
      },
      options: {summary: 'CORS preflight', responses: {'204': {description: 'CORS headers'}}}
    },
    '/api/v1/categories': {
      get: {
        summary: 'list categories',
        description: '세션 사용자 카테고리 목록 (없으면 default 시드).',
        security: [{sessionAuth: []}],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    {$ref: '#/components/schemas/SuccessResponse'},
                    {
                      type: 'object',
                      properties: {
                        data: {type: 'array', items: {$ref: '#/components/schemas/Category'}}
                      }
                    }
                  ]
                }
              }
            }
          },
          '401': {description: 'Unauthorized'}
        }
      },
      post: {
        summary: 'create category',
        security: [{sessionAuth: []}],
        requestBody: {
          required: true,
          content: {
            'application/json': {schema: {$ref: '#/components/schemas/CreateCategoryRequest'}}
          }
        },
        responses: {
          '201': {description: 'Created'},
          '400': {description: 'Invalid input'},
          '401': {description: 'Unauthorized'},
          '409': {description: 'category_name_exists — 이름 중복'}
        }
      },
      options: {summary: 'CORS preflight', responses: {'204': {description: 'CORS headers'}}}
    },
    '/api/v1/categories/{id}': {
      patch: {
        summary: 'update category',
        security: [{sessionAuth: []}],
        parameters: [{name: 'id', in: 'path', required: true, schema: {type: 'string'}}],
        responses: {
          '200': {description: 'OK'},
          '400': {description: 'Invalid input'},
          '401': {description: 'Unauthorized'},
          '404': {description: 'Not found 또는 IDOR 차단'},
          '409': {description: 'category_name_exists'}
        }
      },
      delete: {
        summary: 'delete category',
        description: '소속 스케줄 있으면 ?force=true 필요 (cascade 삭제 사전 경고).',
        security: [{sessionAuth: []}],
        parameters: [
          {name: 'id', in: 'path', required: true, schema: {type: 'string'}},
          {
            name: 'force',
            in: 'query',
            required: false,
            schema: {type: 'boolean'},
            description: 'true 면 소속 스케줄 cascade 삭제'
          }
        ],
        responses: {
          '200': {description: 'Deleted'},
          '401': {description: 'Unauthorized'},
          '409': {description: 'category_has_schedules — force 없이 소속 스케줄 존재'}
        }
      },
      options: {summary: 'CORS preflight', responses: {'204': {description: 'CORS headers'}}}
    },
    '/api/v1/settings': {
      get: {
        summary: 'get settings',
        description: '세션 사용자 설정 (없으면 default 생성).',
        security: [{sessionAuth: []}],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    {$ref: '#/components/schemas/SuccessResponse'},
                    {
                      type: 'object',
                      properties: {data: {$ref: '#/components/schemas/AppSettings'}}
                    }
                  ]
                }
              }
            }
          },
          '401': {description: 'Unauthorized'}
        }
      },
      patch: {
        summary: 'update settings',
        description: '부분 갱신 (theme · focusViewMin).',
        security: [{sessionAuth: []}],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                minProperties: 1,
                properties: {
                  theme: {type: 'string', enum: ['light', 'dark', 'system']},
                  focusViewMin: {type: 'integer', minimum: 60, maximum: 1440}
                }
              }
            }
          }
        },
        responses: {
          '200': {description: 'OK'},
          '400': {description: 'Invalid input'},
          '401': {description: 'Unauthorized'}
        }
      },
      options: {summary: 'CORS preflight', responses: {'204': {description: 'CORS headers'}}}
    },
    '/api/v1/openapi.json': {
      get: {
        summary: 'OpenAPI 3.1 spec',
        description: '본 API spec 영영 fetch 박음. Bearer auth 영영 X (public).',
        security: [],
        responses: {
          '200': {
            description: 'OpenAPI 3.1 JSON spec',
            content: {'application/json': {}}
          }
        }
      }
    }
  }
} as const;

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(OPENAPI_SPEC, {
    status: 200,
    headers: {
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400'
    }
  });
}
