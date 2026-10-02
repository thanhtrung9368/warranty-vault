package com.warrantyvault.app.testing

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import retrofit2.HttpException
import retrofit2.Response

/** Builds the `HttpException` Retrofit throws for an HTTP error response. */
fun httpError(code: Int, body: String): HttpException =
    HttpException(Response.error<Unit>(code, body.toResponseBody("application/json".toMediaType())))
