package com.ssafy.b102.recommendation.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record WorldCupPickRequest(
	@NotBlank @Size(max = 64) String choiceId
) {
}
