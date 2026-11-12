import { createHash } from 'node:crypto'
import { describe, it } from 'vitest'
import { type SurroundGraph, anneal, buildSlots, random, SurroundState } from './annealer'

describe('surround scoring', () => {
  it('preserves the original scores and geometry across seeded searches', ({ expect }) => {
    // Recorded from 2690155f1 before optimization, including the original floating-point order.
    const expected = [
      {
        'seed': 1,
        'cost': 8.163706563706562,
        'geometry': '2cf608056fa2fc6334f6dc49ab5e05282fb9831d958eecd8f55688db57462cc1',
      },
      {
        'seed': 2,
        'cost': 8.150448717948716,
        'geometry': '51ec2410b592d7bc2125e355108d2f56d99cf6f2612ad93db323da334c7870b9',
      },
      {
        'seed': 3,
        'cost': 8.07375656370656,
        'geometry': '8ff58e43274a0a645e726924bc638646aba13863b23b06f52cec1a51667bbfa2',
      },
      {
        'seed': 4,
        'cost': 11.563424358974359,
        'geometry': '7548eee143ac8e2dc0d5b649ada46322c24720f89288a62353b6134b2ec5a806',
      },
      {
        'seed': 5,
        'cost': 11.981499999999995,
        'geometry': '87730bff08ff4731e8ea01f6e497815bc9c6ced06687e02724821f879f032e18',
      },
      {
        'seed': 6,
        'cost': 8.712948717948713,
        'geometry': '3c13cf62b6032b010adea8744d619b7fb84c0e1c5de14254b2ae096b2f36a791',
      },
      {
        'seed': 7,
        'cost': 7.5275750000000015,
        'geometry': '11444d9fcd7797832f4a343a1c57c03efed71b116026e2a88cb89ceb69257238',
      },
      {
        'seed': 8,
        'cost': 8.077767857142856,
        'geometry': '392204d1eac88c4aa6f5bd27e97fc39565ab843cd90a407ee883f0326b41cb3f',
      },
      {
        'seed': 9,
        'cost': 17.385992277992283,
        'geometry': 'f7d69dcf7081b8f4ba823d3b8a9f5ea158542efcc57b0b53a2e7a013fb4e7070',
      },
      {
        'seed': 10,
        'cost': 7.634948717948717,
        'geometry': '463b5ce8001070a7dd0963fcc4a13fbf178fbd442a884584fbda595a3fb02a68',
      },
      {
        'seed': 11,
        'cost': 5.479706563706564,
        'geometry': '5b1dc8961c6bba68c4ebf160f86f1f9cb58e18bf60814c83d7fac0334fe23429',
      },
      {
        'seed': 12,
        'cost': 8.9757,
        'geometry': '94d06d6d53f3594c6888a6cf5d33e0d4210a19580fd7e3b4349a83c794009102',
      },
      {
        'seed': 13,
        'cost': 6.226456563706565,
        'geometry': 'c949dede76382558157bc86e322d4b8b2326e49d0f283d49b526e991995a622b',
      },
      {
        'seed': 14,
        'cost': 11.104998717948718,
        'geometry': 'eb78c0b7598aa50543f10a29162708cbf51a22c288b571612c7990cfd79da8ce',
      },
      {
        'seed': 15,
        'cost': 11.297418436293441,
        'geometry': '8539b71b3f0fcda5a6f044ec72474d515cd54d74f4512b06f8e6ac05f15810d8',
      },
      {
        'seed': 16,
        'cost': 11.397448717948716,
        'geometry': 'a2ade318453bd1028af9949fd6e9aa7c7630340bfbb5ca53e292aeb3222a32b7',
      },
      {
        'seed': 17,
        'cost': 18.020925,
        'geometry': 'c45d9221b01da8245a556b910b86314c92ba8bd97bde545b8a77b9a1917a11af',
      },
      {
        'seed': 18,
        'cost': 6.881498717948715,
        'geometry': 'f409a421062603fd3fe25f9e932ad0169c2716b89d0b5cac13db6986c256c83e',
      },
      {
        'seed': 19,
        'cost': 6.017367479674797,
        'geometry': '8a82f053c713313a7e1538bd0552c69bf57282f3dceb69cbbbafd9173ae360fb',
      },
      {
        'seed': 20,
        'cost': 3.7077487179487183,
        'geometry': 'bb95a5080f20c06ee21b0a56455022bd730492f341975fdb714cd8ec323f69a2',
      },
    ]
    const actual = expected.map(({ seed }) => {
      let state = seed
      const rnd = (n: number) => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state % n
      }
      const graph: SurroundGraph = {
        sizes: Array.from({ length: 12 }, () => [120 + rnd(4) * 30, 90 + rnd(3) * 30]),
        edges: Array.from({ length: 20 }, (_, i) => {
          const source = i % 12
          return [source, (source + 1 + rnd(11)) % 12]
        }),
        inner: [0, 1, 2, 3],
        outer: [4, 5, 6, 7, 8, 9, 10, 11],
      }
      const { centers, polylines, cost } = anneal(graph, { seed, iterations: 2000, aspect: 16 / 9, spare: 4 })
      const geometry = createHash('sha256').update(JSON.stringify({ centers, polylines })).digest('hex')
      return { seed, cost, geometry }
    })
    expect(actual).toEqual(expected)
  })
  for (const arrows of [6, 510]) {
    it(`matches cold scores after moves and rollbacks with ${arrows} arrows`, ({ expect }) => {
      const connections = [[0, 1], [0, 2], [1, 3], [4, 0], [3, 5], [2, 5]] as const
      const graph: SurroundGraph = {
        sizes: [[180, 90], [150, 120], [120, 90], [210, 120], [150, 90], [180, 120]],
        edges: Array.from({ length: arrows }, (_, i) => connections[i % connections.length]!),
        inner: [0, 1],
        outer: [2, 3, 4, 5],
      }
      // The larger case exceeds the cache memory limit and exercises the uncached path.
      const fresh = (indexed = true) =>
        new SurroundState(graph, buildSlots(graph, 16 / 9, 4), random(3), undefined, indexed)
      const warm = fresh()
      const scores = (st: SurroundState) => [
        st.cost([0]),
        st.cost([1, 3], [0]),
        st.cost([2, 4], [1, 3]),
        st.cost([5], [2, 5]),
        st.cost([], [0]),
      ]
      const initialRoute = warm.routes[0]!
      const initialPort = warm.ports[3]![0]
      const initialSlot = warm.slotOf[0]!
      const moves: Array<(st: SurroundState) => void> = [
        st => {
          st.routes[0] = (initialRoute + 1) % 8
          st.refresh([0])
        },
        st => {
          st.ports[3]![0] = initialPort + 0.2
          st.refresh([3])
        },
        st => {
          const slot = st.innerOcc.findIndex(node => node === undefined)
          st.free(st.slotOf[0]!)
          st.place(0, { outer: false, index: slot })
          st.refresh(st.incident[0]!)
        },
        st => {
          const a = st.slotOf[2]!, b = st.slotOf[4]!
          st.place(2, b)
          st.place(4, a)
          st.refresh(new Set([...st.incident[2]!, ...st.incident[4]!]))
        },
        st => {
          st.free(st.slotOf[0]!)
          st.place(0, initialSlot)
          st.routes[0] = initialRoute
          st.ports[3]![0] = initialPort
          st.refresh(new Set([...st.incident[0]!, 3]))
        },
      ]
      scores(warm)
      for (let i = 0; i < moves.length; i++) {
        moves[i]!(warm)
        const cold = fresh(false)
        for (const move of moves.slice(0, i + 1)) {
          move(cold)
        }
        expect(scores(warm), `after move ${i + 1}`).toEqual(scores(cold))
      }
    })
  }
})
