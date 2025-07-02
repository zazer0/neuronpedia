import time
import os
import json
import gc
import requests
import gzip
from datetime import datetime, timezone

from dotenv import load_dotenv
import psutil
import torch
from circuit_tracer.attribution import attribute, compute_salient_logits
from circuit_tracer.utils.create_graph_files import (
    build_model,
    create_nodes,
    create_used_nodes_and_edges,
)
from circuit_tracer.graph import prune_graph
from circuit_tracer.replacement_model import ReplacementModel
from pydantic import BaseModel, ValidationError
from transformers import AutoTokenizer

load_dotenv()

LIMIT_TOKENS = 64
DEFAULT_MAX_FEATURE_NODES = 10000
OFFLOAD = None
UPDATE_INTERVAL = 1000

HF_TOKEN = os.getenv("HF_TOKEN")
if not HF_TOKEN:
    raise ValueError(
        "HF_TOKEN environment variable not set. Please create a .env file with HF_TOKEN=<your_huggingface_token>"
    )

transcoder_name = "gemma"
tlens_model_name = "google/gemma-2-2b"
loaded_scan = "gemma-2-2b"


print(f"Loading model...")
start_time = time.time()
model = ReplacementModel.from_pretrained(tlens_model_name, transcoder_name)
print(f"Model loaded in {time.time() - start_time:.2f} seconds")


def printMemory():
    if torch.cuda.is_available():
        current_memory = torch.cuda.memory_allocated() / (1024**3)
        print(f"GPU memory usage: {current_memory:.2f} GB")
        process = psutil.Process()
        memory_info = process.memory_info()
        memory_usage_gb = memory_info.rss / (1024**3)
        print(f"CPU memory usage: {memory_usage_gb:.2f} GB")


class GraphGenerationRequest(BaseModel):
    prompt: str
    model_id: str
    batch_size: int = 48
    max_n_logits: int = 10
    desired_logit_prob: float = 0.95
    node_threshold: float = 0.8
    edge_threshold: float = 0.98
    slug_identifier: str
    max_feature_nodes: int = DEFAULT_MAX_FEATURE_NODES
    signed_url: str
    user_id: str
    compress: bool = False
    deadline: float | int | None = None
    request_type: str = "graph"


class ForwardPassRequest(BaseModel):
    prompt: str
    max_n_logits: int = 10
    desired_logit_prob: float = 0.95
    deadline: float | int | None = None
    request_type: str = "forward_pass"


def check_deadline(deadline):
    """Check if request deadline has passed. Returns error dict if expired, None otherwise."""
    if deadline:
        current_timestamp = int(time.time())
        if current_timestamp > deadline:
            deadline_utc = datetime.fromtimestamp(deadline, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
            current_utc = datetime.fromtimestamp(current_timestamp, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
            delta_seconds = current_timestamp - deadline
            print(
                f"ERROR: Request deadline already exceeded! Deadline='{deadline_utc}'," 
                f"Current time='{current_utc}', Delta='{delta_seconds}' seconds past deadline"
            )
            return {
                "error": f"Request deadline exceeded by {delta_seconds} seconds. Deadline: {deadline_utc}, Current: {current_utc}",
                "server_time": current_timestamp,
                "deadline": deadline,
                "delta_seconds": delta_seconds,
            }
    return None


def forward_pass_handler(event):
    """Handle forward pass requests to get salient logits"""
    print("========== Forward Pass Start ==========")
    
    # Parse input
    try:
        input = ForwardPassRequest(**event["input"])
    except ValidationError as e:
        return {"error": str(e)}
    
    try:
        # Check deadline first
        deadline_error = check_deadline(input.deadline)
        if deadline_error:
            return deadline_error
            
        print(f"Received forward pass request: prompt='{input.prompt}'")
        
        # Tokenize prompt
        tokens = model.tokenizer.encode(input.prompt, add_special_tokens=True)
        print(f"Tokens: {tokens}")
        
        # Convert to tensor and run forward pass
        input_ids = torch.tensor([tokens])
        
        with torch.no_grad():
            # Get model output
            output = model(input_ids)
            logits = output[0, -1, :]  # Get logits for last token
            
            # Get unembedding matrix
            # Compute salient logits
            logit_indices, logit_probs, _ = compute_salient_logits(
                logits,
                model.unembed.W_U,
                max_n_logits=input.max_n_logits,
                desired_logit_prob=input.desired_logit_prob
            )
        
        # Decode tokens and create result
        results = []
        for idx, prob in zip(logit_indices.tolist(), logit_probs.tolist()):
            token = model.tokenizer.decode([idx])
            results.append({
                "token": token,
                "token_id": idx,
                "probability": float(prob)
            })
        
        # Also include some metadata
        response = {
            "prompt": input.prompt,
            "input_tokens": [model.tokenizer.decode([token]) for token in tokens],
            "salient_logits": results,
            "total_salient_tokens": len(results),
            "cumulative_probability": float(logit_probs.sum())
        }
        
        print(f"Found {len(results)} salient tokens with cumulative prob: {response['cumulative_probability']:.4f}")
        
        return response
        
    except Exception as e:
        print(f"Error in forward pass: {str(e)}")
        return {"error": f"Forward pass failed: {str(e)}"}


def handler(event):
    """Main handler that routes based on request type"""
    
    # Check request type
    request_type = event.get("input", {}).get("request_type", "graph")
    
    if request_type == "forward_pass":
        return forward_pass_handler(event)
    elif request_type == "graph":
        return graph_generation_handler(event)
    else:
        return {"error": f"Unknown request type: {request_type}"}


def graph_generation_handler(event):
    #   This function processes incoming requests to your Serverless endpoint.
    #
    #    Args:
    #        event (dict): Contains the input data and request metadata
    #
    #    Returns:
    #       Any: The result to be returned to the client

    # Extract input data
    print("========== Worker Start ==========")

    # print transcoder name, tlens model name, loaded scan
    print(f"Transcoder Name: {transcoder_name}")
    print(f"TLens Model Name: {tlens_model_name}")
    print(f"Loaded Scan: {loaded_scan}")

    # parse input
    try:
        input = GraphGenerationRequest(**event["input"])
    except ValidationError as e:
        return {"error": str(e)}

    try:
        print(f"Received request with input: {input}")

        prompt = input.prompt
        model_id = input.model_id
        batch_size = input.batch_size
        max_n_logits = input.max_n_logits
        desired_logit_prob = input.desired_logit_prob
        node_threshold = input.node_threshold
        edge_threshold = input.edge_threshold
        slug_identifier = input.slug_identifier
        max_feature_nodes = input.max_feature_nodes
        signed_url = input.signed_url
        user_id = input.user_id
        deadline = input.deadline
        total_start_time = time.time()

        # Check deadline if provided
        deadline_error = check_deadline(deadline)
        if deadline_error:
            return deadline_error

        tokens = model.tokenizer.encode(prompt, add_special_tokens=False)
        print(f"Tokens: {tokens}")

        if len(tokens) > LIMIT_TOKENS:
            return {
                "error": f"Prompt is too long. Max tokens: {LIMIT_TOKENS}, got {len(tokens)}"
            }

        # Start attribution timing
        attribution_start = time.time()
        _graph = attribute(
            prompt,
            model,
            max_n_logits=max_n_logits,
            desired_logit_prob=desired_logit_prob,
            batch_size=batch_size,
            max_feature_nodes=max_feature_nodes,
            offload=OFFLOAD,
            update_interval=UPDATE_INTERVAL,
        )
        attribution_time_ms = (time.time() - attribution_start) * 1000
        print(f"Attribution Time: {attribution_time_ms:.2f}ms")
        
        _graph.to("cuda")

        _node_mask, _edge_mask, _cumulative_scores = (
            el.cpu() for el in prune_graph(_graph, node_threshold, edge_threshold)
        )
        _graph.to("cpu")

        tokenizer = AutoTokenizer.from_pretrained(model.cfg.tokenizer_name)

        _nodes = create_nodes(
            _graph, _node_mask, tokenizer, _cumulative_scores, loaded_scan
        )
        print("nodes created")
        _used_nodes, _used_edges = create_used_nodes_and_edges(
            _graph, _nodes, _edge_mask
        )
        print("used nodes and edges created")
        output_model = build_model(
            _graph,
            _used_nodes,
            _used_edges,
            slug_identifier,
            loaded_scan,
            node_threshold,
            tokenizer,
        )
        print("output model created")
        total_time_ms = time.time() - total_start_time
        print(f"Total Time for task: {total_time_ms=:.2f}s")

        # Add additional metadata fields to the output model

        # Get current timestamp in milliseconds
        current_time_ms = int(time.time() * 1000)
        # Convert to dict to add additional fields
        model_dict = output_model.model_dump()

        # Add additional metadata fields
        model_dict["metadata"]["info"] = {
            "creator_name": user_id if user_id else "Anonymous (CT)",
            "creator_url": "https://neuronpedia.org",
            "source_urls": [
                "https://neuronpedia.org/gemma-2-2b/gemmascope-transcoder-16k",
                "https://huggingface.co/google/gemma-scope-2b-pt-transcoders",
            ],
            "generator": {
                "name": "circuit-tracer by Hanna & Piotrowski",
                "version": "0.1.0 | 1ed3f19",
                "url": "https://github.com/safety-research/circuit-tracer",
            },
            "create_time_ms": current_time_ms,
        }

        model_dict["metadata"]["generation_settings"] = {
            "max_n_logits": max_n_logits,
            "desired_logit_prob": desired_logit_prob,
            "batch_size": batch_size,
            "max_feature_nodes": max_feature_nodes,
        }

        model_dict["metadata"]["pruning_settings"] = {
            "node_threshold": node_threshold,
            "edge_threshold": edge_threshold,
        }

        # Convert back to JSON string
        model_json = json.dumps(model_dict)

        print(f"Uploading file to url: {signed_url}")
        
        # Handle compression if requested
        compress_time_ms = 0
        if input.compress:
            print("Compressing data with gzip (level 3)...")
            compress_start = time.time()
            data_to_upload = gzip.compress(model_json.encode("utf-8"), compresslevel=3)
            compress_time_ms = (time.time() - compress_start) * 1000
            headers = {
                "Content-Type": "application/json",
                "Content-Encoding": "gzip"
            }
        else:
            data_to_upload = model_json.encode("utf-8")
            headers = {"Content-Type": "application/json"}
        
        # Track upload size
        upload_size_bytes = len(data_to_upload)
        
        # Start upload timing
        upload_start = time.time()
        response = requests.put(
            signed_url,
            data=data_to_upload,
            headers=headers,
        )
        upload_time_ms = (time.time() - upload_start) * 1000

        print(f"Upload response: {response.status_code}")
        # print(f"Upload response: {response.text}")
        if response.status_code != 200:
            return {"error": "Failed to upload file"}

        print(f"File: uploaded successfully to url: {signed_url}")
        
        # Total time
        total_time_ms = (time.time() - total_start_time) * 1000
        
        # Log timing summary
        timing_parts = [
            f"attribution_ms={attribution_time_ms:.0f}",
            f"upload_ms={upload_time_ms:.0f}",
            f"upload_size_bytes={upload_size_bytes}",
            f"upload_size_mb={upload_size_bytes / (1024 * 1024):.2f}",
            f"total_ms={total_time_ms:.0f}"
        ]
        
        if input.compress:
            timing_parts.extend([
                f"compress_ms={compress_time_ms:.0f}",
                f"compression_ratio={len(model_json.encode('utf-8')) / upload_size_bytes:.2f}"
            ])
        
        print(f"TIMING_SUMMARY: {' '.join(timing_parts)}")
        
        return {"success": f"File: uploaded successfully to url: {signed_url}"}

    # no except since apparently runpod will handle it and return "error" in json

    finally:
        printMemory()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            print("Cleared CUDA cache")

        gc.collect()
        print("Cleared CPU memory")

    return output_model


# Start the Serverless function when the script is run
if __name__ == "__main__":
    import runpod
    runpod.serverless.start({"handler": handler})
