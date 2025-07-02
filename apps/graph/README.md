#### neuronpedia 🧠🔍 graph server

This is the attribution graph generation server based on [circuit-tracer](https://github.com/safety-research/circuit-tracer) by Piotrowski & Hanna. These endpoints are what's called when you click `+ New Graph` on the [Neuronpedia Circuit Tracer](https://www.neuronpedia.org/gemma-2-2b/graph) page.

- [Install](#install)
- [Config](#config)
- [Start Server](#start-server)
- [Example Request - Output Graph JSON Directly](#example-request---output-graph-json-directly)
- [Example Request - Output Graph JSON to S3 with presigned URL](#example-request---output-graph-json-to-s3-with-presigned-url)
- [Runpod Serverless](#runpod-serverless)

### Install

```
# Navigate to the graph app directory
cd apps/graph

# Install dependencies using Poetry
poetry install
```

### Config

Create an `.env` file with `SECRET` and `HF_TOKEN` (see `.env.example`)

- `SECRET` is the server secret that needs to be passed in the `x-secret-key` request header (see examples below)
- Make sure your `HF_TOKEN` has access to the [Gemma-2-2B model](https://huggingface.co/google/gemma-2-2b) on Huggingface.

### Start Server

```
# Make sure you are in the apps/graph directory

# Only run one of the following, depending on which model you want to run.

# Run with Gemma-2-2B model with the Gemmascope transcoders
poetry run python neuronpedia_graph/server.py google/gemma-2-2b

# Run with Llama-3.2-1B model with transcoders trained by Anthropic Fellows
poetry run python neuronpedia_graph/server.py meta-llama/Llama-3.2-1B
```

### Example Request - Output Graph JSON Directly

This will run a graph generation for the prompt "1 2 " on Gemma-2-2B.

> Warning: This will be a large text response (2MB), so you may want to pipe it into a file by appending this at the end: ` > count12.json`.

```
curl -X POST http://localhost:5004/generate-graph \
  -H "Content-Type: application/json" \
  -H "x-secret-key: YOUR_SECRET" \
  -d '{
    "prompt": "1 2 ",
    "model_id": "google/gemma-2-2b",
    "batch_size": 48,
    "max_n_logits": 10,
    "desired_logit_prob": 0.95,
    "node_threshold": 0.8,
    "edge_threshold": 0.85,
    "slug_identifier": "count-1-2",
    "max_feature_nodes" : 5000
  }'
```

### Example Request - Output Graph JSON to S3 with presigned URL

Since the graph JSONs can be large (up to 100MB+ sometimes!), on Neuronpedia we store the JSONs on S3. When the webapp calls the graph server for a graph generation, instead of returning this large file back to the webapp, we have the graph server upload it directly to S3. Then, when the user requests the graph on the webapp, it's downloaded from S3.

This adds two parameters to the request:

- `signed_url`(URL string): Signed S3 PUT request, which the graph server will use to directly upload the json file.
- `compress`(boolean): Whether or not to gzip the JSON before uploading.

To use upload graphs to S3 with this, you'll need to:

1. Create an S3 bucket with public read permissions.
2. Create an S3 access key+secret pair that has PUT permissions for that bucket.
3. Using those S3 access credentials, generate the `signed_url` with an S3 library.

- [Here is the Typescript code](https://github.com/hijohnnylin/neuronpedia/blob/58350119d64fc1089b007a7a29a9ce3686cf950d/apps/webapp/app/api/graph/generate/route.ts#L222-L243) for how we generate `signed_url` on Neuronpedia when a request for generating graphs comes in.
- To do this in Python, you can reference [examples like this](https://jimbobbennett.dev/blogs/get-put-s3-boto/).

Finally, the example command (it won't work unless you replace `S3_SIGNED_PUT_URL`):

```
curl -X POST http://localhost:5004/generate-graph \
  -H "Content-Type: application/json" \
  -H "x-secret-key: YOUR_SECRET" \
  -d '{
    "prompt": "1 2 ",
    "model_id": "google/gemma-2-2b",
    "batch_size": 48,
    "max_n_logits": 10,
    "desired_logit_prob": 0.95,
    "node_threshold": 0.8,
    "edge_threshold": 0.85,
    "slug_identifier": "count-1-2",
    "max_feature_nodes" : 5000,
    "signed_url": S3_SIGNED_PUT_URL
  }'
```

### Runpod Serverless

The `apps/graph/runpod` directory contains a [Runpod Serverless](https://docs.runpod.io/serverless/overview) worker that does the same as `apps/graph` - it just in a format the Runpod expects. It has its own `README.md`.
