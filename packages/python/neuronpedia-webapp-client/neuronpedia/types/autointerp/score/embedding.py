# generated by datamodel-codegen:
#   filename:  embedding.yaml

from __future__ import annotations

from typing import List, Union

from pydantic import BaseModel, Field


class NPScoreEmbeddingOutput(BaseModel):
    text: str = Field(..., description='The text that was used to evaluate the similarity')
    distance: Union[float, int] = Field(..., description='Quantile or neighbor distance')
    similarity: float = Field(..., description='What is the similarity of the example to the explanation')


class NPActivation(BaseModel):
    tokens: List[str] = Field(..., description='List of tokens for this text', example=['The', 'cat', 'sat'])
    values: List[float] = Field(
        ..., description='Activation values corresponding to each token', example=[0.5, 0.8, 0.2]
    )


class NPScoreEmbeddingResponse(BaseModel):
    score: float = Field(..., description='The score from 0 to 1')
    breakdown: List[NPScoreEmbeddingOutput] = Field(..., description='Detailed breakdown of the embedding outputs')


class NPScoreEmbeddingRequest(BaseModel):
    activations: List[NPActivation] = Field(..., description='List of activation records to analyze')
    explanation: str = Field(
        ..., description='The explanation to evaluate', example='This neuron activates on references to feline behavior'
    )
    secret: str = Field(..., description='Authentication secret for the API', example='your-secret-key')
