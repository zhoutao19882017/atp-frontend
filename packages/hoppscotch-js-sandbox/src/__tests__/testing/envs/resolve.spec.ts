import * as TE from "fp-ts/TaskEither"
import { pipe } from "fp-ts/function"

import { runTestScript } from "~/test-runner/node-vm"
import { TestResponse, TestResult } from "~/types"

const fakeResponse: TestResponse = {
  status: 200,
  body: "hoi",
  headers: [],
}

const func = (script: string, envs: TestResult["envs"]) =>
  pipe(
    runTestScript(script, envs, fakeResponse),
    TE.map((x) => x.tests)
  )

describe("pw.env.resolve", () => {
  test("value should be a string", () => {
    return expect(
      func(
        `
          pw.env.resolve(5)
        `,
        {
          global: [],
          selected: [],
        }
      )()
    ).resolves.toBeLeft()
  })

  test("resolves global variables correctly", () => {
    return expect(
      func(
        `
          const data = pw.env.resolve("<<hello>>")
          pw.expect(data).toBe("there")
        `,
        {
          global: [
            {
              key: "hello",
              value: "there",
              secret: false,
            },
          ],
          selected: [],
        }
      )()
    ).resolves.toEqualRight([
      expect.objectContaining({
        expectResults: [
          {
            status: "pass",
            message: "Expected 'there' to be 'there'",
          },
        ],
      }),
    ])
  })

  test("resolves selected env variables correctly", () => {
    return expect(
      func(
        `
          const data = pw.env.resolve("<<hello>>")
          pw.expect(data).toBe("there")
        `,
        {
          global: [],
          selected: [
            {
              key: "hello",
              value: "there",
              secret: false,
            },
          ],
        }
      )()
    ).resolves.toEqualRight([
      expect.objectContaining({
        expectResults: [
          {
            status: "pass",
            message: "Expected 'there' to be 'there'",
          },
        ],
      }),
    ])
  })

  test("chooses selected env variable over global variables when both have same variable", () => {
    return expect(
      func(
        `
          const data = pw.env.resolve("<<hello>>")
          pw.expect(data).toBe("there")
        `,
        {
          global: [
            {
              key: "hello",
              value: "yo",
              secret: false,
            },
          ],
          selected: [
            {
              key: "hello",
              value: "there",
              secret: false,
            },
          ],
        }
      )()
    ).resolves.toEqualRight([
      expect.objectContaining({
        expectResults: [
          {
            status: "pass",
            message: "Expected 'there' to be 'there'",
          },
        ],
      }),
    ])
  })

  test("if infinite loop in resolution, abandons resolutions altogether", () => {
    return expect(
      func(
        `
          const data = pw.env.resolve("<<hello>>")
          pw.expect(data).toBe("<<hello>>")
        `,
        {
          global: [],
          selected: [
            {
              key: "hello",
              value: "<<there>>",
              secret: false,
            },
            {
              key: "there",
              value: "<<hello>>",
              secret: false,
            },
          ],
        }
      )()
    ).resolves.toEqualRight([
      expect.objectContaining({
        expectResults: [
          {
            status: "pass",
            message: "Expected '<<hello>>' to be '<<hello>>'",
          },
        ],
      }),
    ])
  })
})
