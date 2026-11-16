import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

const http = httpRouter();

// Clock-sync ping. Phones call this several times and use the fastest round
// trip to estimate how far their own clock is from the server's.
http.route({
  path: "/time",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(JSON.stringify({ t: Date.now() }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

export default http;
