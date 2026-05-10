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
                  'category_not_found',
                  'task_not_found',
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
